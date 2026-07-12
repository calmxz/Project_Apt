"""Learning event recording + automatic demotion of mastered concepts.

Demotion rule (Spec §3.3, §3.4): if correct=False AND gap_tested is currently
in mastered_concepts, remove it from mastered_concepts.

record_learning_event is no longer an LLM tool; recording happens server-side
via record_from_answer when the learner clicks a check-question answer. The
is_gradable turn-barrier (pending_check_store) is therefore not consulted here.
"""

import json
from datetime import datetime, timezone

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from db.models import LearningEvent
from services import pending_check_store, profile_service


def record_from_answer(
    db: Session,
    session_id: str,
    *,
    gap: str,
    question: str,
    correct: bool,
    selected_index: int | None = None,
    correct_index: int | None = None,
    options: list[str] | None = None,
    purpose: str = "check",
    clear_pending: bool = True,
    commit: bool = True,
    apply_profile_effects: bool = True,
) -> LearningEvent:
    """Record a learner's clicked check-question answer (deterministic path).

    clear_pending=False / commit=False let the batch caller (check_question_service.
    answer) keep the rest of the batch open and fold this into one commit.

    This bypasses the is_gradable turn-barrier: a human click is not the LLM,
    and record_learning_event is no longer a tool, so the ask-and-self-grade
    exploit the barrier guarded against is impossible.

    Applies the deterministic profile effects, because the click is silent and
    the agent's only next-turn signal is the profile state:
    - correct  -> add gap to mastered_concepts (tested mastery)
    - incorrect-> remove gap from mastered_concepts if present (demotion), and add
      gap to confirmed_gaps if not already present (an incorrect retest is
      confirmed-gap evidence, so the demoted concept is a valid review target)

    apply_profile_effects=False (used by the knowledge diagnostic) still writes
    the LearningEvent but skips the mastered_concepts mutation entirely, so a
    correct diagnostic answer cannot pollute the profile with a fake "tested
    mastery" promotion.
    """
    event = LearningEvent(
        session_id=session_id,
        gap_tested=gap,
        question=question,
        correct=correct,
        selected_index=selected_index,
        correct_index=correct_index,
        options_json=json.dumps(options) if options is not None else None,
        purpose=purpose,
    )
    db.add(event)
    db.flush()

    if apply_profile_effects:
        profile = profile_service.load_profile(db, session_id)
        stamp = datetime.now(timezone.utc)
        if correct:
            profile.mastered_concepts = profile_service.upsert_entry(
                profile.mastered_concepts or [], gap,
                evidence_type="tested", stamp=stamp,
            )
            gap_entry = profile_service.find_entry(profile.confirmed_gaps or [], gap)
            if gap_entry is not None:
                gap_entry.evidence_type = "tested"
                gap_entry.last_event_at = stamp
        else:
            key = profile_service.canon(gap)
            profile.mastered_concepts = [
                e for e in (profile.mastered_concepts or []) if profile_service.canon(e.name) != key
            ]
            profile.confirmed_gaps = profile_service.upsert_entry(
                profile.confirmed_gaps or [], gap,
                evidence_type="tested", stamp=stamp,
            )
        profile_service.save_profile(db, session_id, profile, commit=False)

    if clear_pending:
        pending_check_store.clear_pending_check(db, session_id, commit=False)
    if commit:
        db.commit()
        db.refresh(event)
    return event


def gap_accuracy(db: Session, session_id: str) -> dict[str, dict]:
    """Per-gap attempts and correct counts for one session (D1.2).

    Session-scoped by design: cross-session accuracy is R2's review-queue
    concern and will be queried at user level there.
    """
    rows = db.execute(
        select(
            LearningEvent.gap_tested,
            func.count().label("attempts"),
            func.sum(case((LearningEvent.correct, 1), else_=0)).label("correct"),
        )
        .where(LearningEvent.session_id == session_id)
        .group_by(LearningEvent.gap_tested)
    ).all()
    return {r.gap_tested: {"attempts": int(r.attempts), "correct": int(r.correct or 0)} for r in rows}

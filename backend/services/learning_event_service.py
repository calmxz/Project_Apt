"""Learning event recording + automatic demotion of mastered concepts.

Demotion rule (Spec §3.3, §3.4): if correct=False AND gap_tested is currently
in mastered_concepts, remove it from mastered_concepts.

record_learning_event is no longer an LLM tool; recording happens server-side
via record_from_answer when the learner clicks a check-question answer. The
is_gradable turn-barrier (pending_check_store) is therefore not consulted here.
"""

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
    - incorrect-> remove gap from mastered_concepts if present (demotion)

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
    )
    db.add(event)
    db.flush()

    if apply_profile_effects:
        profile = profile_service.load_profile(db, session_id)
        mastered = list(profile.mastered_concepts or [])
        if correct:
            if gap not in mastered:
                mastered.append(gap)
                profile.mastered_concepts = mastered
                profile_service.save_profile(db, session_id, profile, commit=False)
        else:
            if gap in mastered:
                profile.mastered_concepts = [c for c in mastered if c != gap]
                profile_service.save_profile(db, session_id, profile, commit=False)

    if clear_pending:
        pending_check_store.clear_pending_check(db, session_id, commit=False)
    if commit:
        db.commit()
        db.refresh(event)
    return event

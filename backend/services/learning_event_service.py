"""Learning event recording + automatic demotion of mastered concepts.

Demotion rule (Spec §3.3, §3.4): if correct=False AND gap_tested is currently
in mastered_concepts, remove it from mastered_concepts.

Grading guard (Spec workstream A1, Layer B): a LearningEvent can only be
recorded if a pending check-question for the same gap was asked in a PRIOR
turn. This prevents the tutor from asking and self-grading in a single turn.
"""

from sqlalchemy.orm import Session

from agent.types import ToolContext
from contracts import RecordLearningEventArgs, ToolResult
from db.models import LearningEvent
from services import check_question_service, profile_service


def record(
    db: Session, ctx: ToolContext, args: RecordLearningEventArgs
) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )

    if not check_question_service.is_gradable(
        db, ctx.session_id, gap=args.gap_tested, current_turn=ctx.turn_started_at
    ):
        return ToolResult(
            ok=False,
            status="failed",
            error=(
                "no open check-question for this gap from a prior turn; "
                "ask one with ask_check_questions and wait for the learner's answer"
            ),
        )

    event = LearningEvent(
        session_id=ctx.session_id,
        gap_tested=args.gap_tested,
        question=args.question,
        correct=args.correct,
    )
    db.add(event)
    db.flush()

    if not args.correct:
        profile = profile_service.load_profile(db, ctx.session_id)
        if args.gap_tested in (profile.mastered_concepts or []):
            profile.mastered_concepts = [
                c for c in profile.mastered_concepts if c != args.gap_tested
            ]
            profile_service.save_profile(db, ctx.session_id, profile)

    check_question_service.clear_pending_check(db, ctx.session_id, commit=False)
    db.commit()
    db.refresh(event)
    return ToolResult(ok=True, status="ok", data={"event_id": event.id, "correct": args.correct})


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

    Unlike record(), this bypasses the is_gradable turn-barrier: a human click
    is not the LLM, and record_learning_event is no longer a tool, so the
    ask-and-self-grade exploit the barrier guarded against is impossible.

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
        check_question_service.clear_pending_check(db, session_id, commit=False)
    if commit:
        db.commit()
        db.refresh(event)
    return event

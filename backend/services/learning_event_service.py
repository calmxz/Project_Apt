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
                "ask one with ask_check_question and wait for the learner's answer"
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

    db.commit()
    db.refresh(event)
    check_question_service.clear_pending_check(db, ctx.session_id)
    return ToolResult(ok=True, status="ok", data={"event_id": event.id, "correct": args.correct})

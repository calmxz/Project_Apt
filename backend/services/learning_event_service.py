"""Learning event recording + automatic demotion of mastered concepts.

Demotion rule (Spec §3.3, §3.4): if correct=False AND gap_tested is currently
in mastered_concepts, remove it from mastered_concepts.
"""

from sqlalchemy.orm import Session

from agent.types import ToolContext
from contracts import RecordLearningEventArgs, ToolResult
from db.models import LearningEvent
from services import profile_service


def record(
    db: Session, ctx: ToolContext, args: RecordLearningEventArgs
) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
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
    return ToolResult(ok=True, status="ok", data={"event_id": event.id})

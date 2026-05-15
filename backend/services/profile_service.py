"""Profile patch service. Spec §3.4 v1 simplified rules.

Rules:
- Declared / tested mastery -> directly to mastered_concepts.
- Inferred mastery -> ignored (no-op, ok=True).
- Duplicate gap or concept additions -> no-op.
- knowledge_level overwrites.
- focus_target_gap clearing requires focus_clear_reason. If reason is
  "tested_correct", a matching correct LearningEvent must exist within the
  current turn (created_at >= ctx.turn_started_at).
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from agent.types import ToolContext
from contracts import ToolResult, TopicProfile, UpdateTopicProfileArgs
from db.models import LearningEvent, Session as SessionModel


log = logging.getLogger(__name__)


def load_profile(db: Session, session_id: str) -> TopicProfile:
    row = db.get(SessionModel, session_id)
    if row is None:
        return TopicProfile()
    return TopicProfile.model_validate_json(row.topic_profile_json or "{}")


def save_profile(db: Session, session_id: str, profile: TopicProfile) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    row.topic_profile_json = profile.model_dump_json()
    db.commit()


def seed_from_prior(db: Session, new_session: SessionModel, prior: SessionModel) -> None:
    new_session.topic_profile_json = prior.topic_profile_json
    db.commit()


def _norm_list(values: list[str] | None) -> list[str]:
    return list(values) if values else []


def apply_patch(
    db: Session, ctx: ToolContext, args: UpdateTopicProfileArgs
) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )

    profile = load_profile(db, ctx.session_id)
    confirmed = _norm_list(profile.confirmed_gaps)
    mastered = _norm_list(profile.mastered_concepts)
    prior_focus = profile.focus_target_gap

    if args.knowledge_level is not None:
        profile.knowledge_level = args.knowledge_level

    if args.add_confirmed_gap and args.add_confirmed_gap not in confirmed:
        confirmed.append(args.add_confirmed_gap)

    if args.add_mastered_concept and args.evidence_type in ("declared", "tested"):
        if args.add_mastered_concept not in mastered:
            mastered.append(args.add_mastered_concept)

    # focus_target_gap handling
    clearing = prior_focus is not None and args.focus_target_gap is None
    if clearing:
        if args.focus_clear_reason is None:
            return ToolResult(
                ok=False,
                status="failed",
                error="focus_clear_reason required when clearing focus",
            )
        if args.focus_clear_reason == "tested_correct":
            ev = db.execute(
                select(LearningEvent).where(
                    LearningEvent.session_id == ctx.session_id,
                    LearningEvent.gap_tested == prior_focus,
                    LearningEvent.correct.is_(True),
                    LearningEvent.created_at >= ctx.turn_started_at,
                )
            ).scalars().first()
            if ev is None:
                return ToolResult(
                    ok=False,
                    status="failed",
                    error="tested_correct requires a correct LearningEvent logged this turn",
                )
        log.info(
            "focus_clear session=%s gap=%s reason=%s",
            ctx.session_id,
            prior_focus,
            args.focus_clear_reason,
        )
        profile.focus_target_gap = None
    elif args.focus_target_gap is not None:
        profile.focus_target_gap = args.focus_target_gap

    profile.confirmed_gaps = confirmed
    profile.mastered_concepts = mastered
    save_profile(db, ctx.session_id, profile)

    return ToolResult(ok=True, status="ok")

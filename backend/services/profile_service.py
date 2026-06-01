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

import json
import logging

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from agent.types import ToolContext
from contracts import (
    AggregateConceptCount,
    AggregateProfileResponse,
    KnowledgeLevelDistribution,
    RecentSessionSummary,
    ToolResult,
    TopicProfile,
    UpdateTopicProfileArgs,
)
from db.models import LearningEvent, Session as SessionModel


log = logging.getLogger(__name__)


def _parse_profile(raw: str | None) -> TopicProfile:
    """Tolerantly deserialize a stored topic_profile_json blob.

    TopicProfile is codegen'd with extra="forbid" (correct for validating tool
    args the model sends), but the same model deserializes persisted state that
    may have been written under an older schema. During an iterative build the
    profile shape sheds fields, and resume copies a prior session's raw JSON
    forward (sessions.py / seed_from_prior); a retired field left in an old row
    would otherwise raise ValidationError and 500 every read of that session
    (and the whole /profile aggregate). So: try strict parse, then drop unknown
    keys and re-validate, then fall back to an empty profile. Never raises.
    """
    raw = raw or "{}"
    try:
        return TopicProfile.model_validate_json(raw)
    except ValidationError:
        pass
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("unparseable topic_profile_json; using empty profile")
        return TopicProfile()
    if not isinstance(data, dict):
        return TopicProfile()
    known = {k: v for k, v in data.items() if k in TopicProfile.model_fields}
    dropped = sorted(set(data) - set(known))
    try:
        profile = TopicProfile.model_validate(known)
    except ValidationError:
        log.warning("topic_profile failed strict reparse; using empty profile")
        return TopicProfile()
    if dropped:
        log.warning("dropped legacy topic_profile fields on load: %s", dropped)
    return profile


def load_profile(db: Session, session_id: str) -> TopicProfile:
    row = db.get(SessionModel, session_id)
    if row is None:
        return TopicProfile()
    return _parse_profile(row.topic_profile_json)


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

    if args.add_mastered_concept:
        if args.evidence_type is None:
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "evidence_type must be 'declared' or 'tested' when "
                    "add_mastered_concept is set"
                ),
            )
        if args.evidence_type in ("declared", "tested"):
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


def aggregate_for_user(db: Session, user_id: str) -> AggregateProfileResponse:
    """Cross-session aggregate. Pure SQL + Python, no LLM calls."""
    sessions: list[SessionModel] = db.execute(
        select(SessionModel)
        .where(SessionModel.user_id == user_id)
        .order_by(SessionModel.created_at.asc())
    ).scalars().all()

    total = len(sessions)
    active = sum(1 for s in sessions if s.ended_at is None)
    ended = total - active

    mastered_counts: dict[str, dict] = {}
    gap_counts: dict[str, dict] = {}
    level_dist = {"beginner": 0, "intermediate": 0, "advanced": 0, "unknown": 0}
    last_active_at = None

    for s in sessions:
        profile = _parse_profile(s.topic_profile_json)

        level_key = profile.knowledge_level or "unknown"
        level_dist[level_key] = level_dist.get(level_key, 0) + 1

        for concept in profile.mastered_concepts or []:
            entry = mastered_counts.setdefault(
                concept, {"count": 0, "first_seen_session_id": s.id}
            )
            entry["count"] += 1

        for gap in profile.confirmed_gaps or []:
            entry = gap_counts.setdefault(
                gap, {"count": 0, "first_seen_session_id": s.id}
            )
            entry["count"] += 1

        candidate = s.ended_at or s.created_at
        if candidate is not None and (
            last_active_at is None or candidate > last_active_at
        ):
            last_active_at = candidate

    def _to_sorted_list(d: dict[str, dict]) -> list[AggregateConceptCount]:
        return sorted(
            (
                AggregateConceptCount(
                    concept=name,
                    count=v["count"],
                    first_seen_session_id=v["first_seen_session_id"],
                )
                for name, v in d.items()
            ),
            key=lambda x: (-x.count, x.concept),
        )

    session_ids = [s.id for s in sessions]
    if session_ids:
        total_events = db.execute(
            select(func.count(LearningEvent.id)).where(
                LearningEvent.session_id.in_(session_ids)
            )
        ).scalar_one()
    else:
        total_events = 0

    # `sessions` already ordered by created_at asc; last 5 reversed = newest first.
    recent = list(reversed(sessions[-5:]))
    recent_topics = [
        RecentSessionSummary(
            id=s.id,
            topic=s.topic or "",
            created_at=s.created_at,
            ended_at=s.ended_at,
            last_session_summary=_parse_profile(
                s.topic_profile_json
            ).last_session_summary,
        )
        for s in recent
    ]

    return AggregateProfileResponse(
        total_sessions=total,
        active_sessions=active,
        ended_sessions=ended,
        total_learning_events=int(total_events or 0),
        last_active_at=last_active_at,
        combined_mastered_concepts=_to_sorted_list(mastered_counts),
        combined_confirmed_gaps=_to_sorted_list(gap_counts),
        knowledge_level_distribution=KnowledgeLevelDistribution(**level_dist),
        recent_topics=recent_topics,
    )

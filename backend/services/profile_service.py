"""Profile patch service. Spec §3.4 v1 simplified rules.

Rules:
- Declared / tested mastery -> directly to mastered_concepts.
- Inferred mastery -> ignored (no-op, ok=True).
- Duplicate gap or concept additions -> no-op.
- knowledge_level overwrites.
- focus_target_gap clearing requires focus_clear_reason (any non-None value).
  The tested_correct in-turn-event guard is removed: record_learning_event is
  now a human click, not an LLM tool, so server-side event evidence is moot.
"""

import hashlib
import json
import logging
from typing import Literal

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
from services.session_enrichment import compute_enrichment


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


def save_profile(
    db: Session, session_id: str, profile: TopicProfile, commit: bool = True
) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    row.topic_profile_json = profile.model_dump_json()
    if commit:
        db.commit()


def seed_from_prior(db: Session, new_session: SessionModel, prior: SessionModel) -> None:
    new_session.topic_profile_json = prior.topic_profile_json
    db.commit()


def _norm_list(values: list[str] | None) -> list[str]:
    return list(values) if values else []


def profile_etag(profile: TopicProfile) -> str:
    return hashlib.sha256(profile.model_dump_json().encode("utf-8")).hexdigest()


def _null_focus_if_removed(profile: TopicProfile, item: str) -> None:
    if profile.focus_target_gap == item:
        profile.focus_target_gap = None


def _add_exclusive(profile: TopicProfile, target: str, item: str) -> None:
    other = "confirmed_gaps" if target == "mastered_concepts" else "mastered_concepts"
    tgt = _norm_list(getattr(profile, target))
    oth = _norm_list(getattr(profile, other))
    if item not in tgt:
        tgt.append(item)
    oth = [x for x in oth if x != item]
    setattr(profile, target, tgt)
    setattr(profile, other, oth)
    if other == "confirmed_gaps":
        _null_focus_if_removed(profile, item)


def apply_user_patch(
    db: Session,
    session_id: str,
    *,
    add_mastered: str | None = None,
    add_gap: str | None = None,
    knowledge_level: str | None = None,
) -> TopicProfile:
    if db.get(SessionModel, session_id) is None:
        raise ValueError(f"session not found: {session_id}")
    profile = load_profile(db, session_id)
    if add_mastered is not None:
        _add_exclusive(profile, "mastered_concepts", add_mastered)
    if add_gap is not None:
        _add_exclusive(profile, "confirmed_gaps", add_gap)
    if knowledge_level is not None:
        profile.knowledge_level = knowledge_level
    save_profile(db, session_id, profile)
    return profile


def remove_profile_item(
    db: Session,
    session_id: str,
    list_name: Literal["mastered_concepts", "confirmed_gaps"],
    item: str,
) -> TopicProfile:
    profile = load_profile(db, session_id)
    current = _norm_list(getattr(profile, list_name))
    if item not in current:
        raise KeyError(item)
    setattr(profile, list_name, [x for x in current if x != item])
    if list_name == "confirmed_gaps":
        _null_focus_if_removed(profile, item)
    save_profile(db, session_id, profile)
    return profile


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
        # The tested_correct evidence guard was removed: record_learning_event is
        # no longer a tool, so the LLM cannot fabricate a LearningEvent, and the
        # ask-and-self-grade exploit the guard prevented is impossible. Mastery is
        # now server-authoritative (record_from_answer), so the agent clears focus
        # by judgment from the profile it reads, not from in-turn event evidence.
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
    recent_enr = compute_enrichment(db, recent)
    recent_topics = [
        RecentSessionSummary(
            id=s.id,
            topic=s.topic or "",
            created_at=s.created_at,
            ended_at=s.ended_at,
            last_session_summary=recent_enr[s.id].last_session_summary,
            message_count=recent_enr[s.id].message_count,
            last_activity_at=recent_enr[s.id].last_activity_at,
            last_message_preview=recent_enr[s.id].last_message_preview,
            progress=recent_enr[s.id].progress,
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

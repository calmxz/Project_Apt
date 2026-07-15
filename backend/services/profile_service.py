"""Profile patch service. Spec §3.4 v1 simplified rules.

Rules:
- Declared / tested mastery -> directly to mastered_concepts.
- Inferred mastery -> ignored (no-op, ok=True).
- Duplicate gap or concept additions -> no-op.
- knowledge_level overwrites.
- focus_target_gap clearing requires focus_clear_reason; omitting the focus
  field without a reason leaves focus unchanged (F-23). Reason
  "tested_correct" is server-verified against a correct LearningEvent for the
  focused gap in this session (F-02, restored per owner decision Q1).
"""

import hashlib
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from agent.types import ToolContext
from contracts import (
    AggregateConceptCount,
    AggregateProfileResponse,
    ConceptAccuracy,
    ConceptEntry,
    KnowledgeLevelDistribution,
    RecentSessionSummary,
    ToolResult,
    TopicProfile,
    UpdateTopicProfileArgs,
    WeeklyMasteryPoint,
)
from db.models import LearningEvent, Session as SessionModel
from services.session_enrichment import aware_utc, compute_enrichment


log = logging.getLogger(__name__)

MAX_SUBTOPICS = 20


def canon(name: str) -> str:
    return name.strip().casefold()


def _has_correct_event_for(db: Session, session_id: str, gap: str) -> bool:
    """F-02 guard (decision Q1): session-scoped proof that a correct
    check-question answer was recorded for this gap. canon-compared in Python
    because gap_tested is stored raw."""
    key = canon(gap)
    rows = db.execute(
        select(LearningEvent.gap_tested)
        .where(
            LearningEvent.session_id == session_id,
            LearningEvent.correct.is_(True),
        )
    ).scalars().all()
    return any(canon(g) == key for g in rows)


def concept_names(entries: list | None) -> list[str]:
    return [e.name for e in (entries or [])]


def find_entry(entries: list, name: str):
    key = canon(name)
    for e in entries or []:
        if canon(e.name) == key:
            return e
    return None


def upsert_entry(
    entries: list, name: str, *, evidence_type: str | None, stamp: datetime | None
) -> list:
    """Append a ConceptEntry if name (casefolded) is absent; otherwise update
    the existing entry's provenance in place. Returns the (new) list."""
    out = list(entries or [])
    existing = find_entry(out, name)
    if existing is None:
        out.append(
            ConceptEntry(name=name, evidence_type=evidence_type, last_event_at=stamp)
        )
        return out
    if evidence_type is not None:
        existing.evidence_type = evidence_type
    if stamp is not None:
        existing.last_event_at = stamp
    return out


def _upgrade_concept_lists(data: dict) -> dict:
    """Element-level legacy upgrade: bare-string concepts become ConceptEntry
    dicts. Permanent, not a transition shim: seed_from_prior copies raw JSON
    forward on resume, so pre-slice-8 blobs can arrive indefinitely."""
    for key in ("mastered_concepts", "confirmed_gaps"):
        items = data.get(key)
        if isinstance(items, list):
            data[key] = [
                {"name": it, "evidence_type": None, "last_event_at": None}
                if isinstance(it, str)
                else it
                for it in items
            ]
    return data


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
    Also upgrades legacy bare-string concept-list elements to ConceptEntry
    dicts before validation (see _upgrade_concept_lists).
    """
    raw = raw or "{}"
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("unparseable topic_profile_json; using empty profile")
        return TopicProfile()
    if not isinstance(data, dict):
        return TopicProfile()
    data = _upgrade_concept_lists(data)
    try:
        return TopicProfile.model_validate(data)
    except ValidationError:
        pass
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


def profile_from_row(row: SessionModel | None) -> TopicProfile:
    if row is None:
        return TopicProfile()
    return _parse_profile(row.topic_profile_json)


def load_profile(db: Session, session_id: str) -> TopicProfile:
    return profile_from_row(db.get(SessionModel, session_id))


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


def profile_etag(profile: TopicProfile) -> str:
    return hashlib.sha256(profile.model_dump_json().encode("utf-8")).hexdigest()


def _null_focus_if_removed(profile: TopicProfile, item: str) -> None:
    # F-22: removal matches by canon(), so the dangling-focus check must too.
    if profile.focus_target_gap is not None and canon(profile.focus_target_gap) == canon(item):
        profile.focus_target_gap = None


def add_exclusive(
    profile: TopicProfile,
    target: str,
    item: str,
    *,
    evidence_type: str | None = None,
    stamp: datetime | None = None,
) -> None:
    """Single choke point for the exclusivity invariant (F-13, decision Q2):
    adding a concept to one list removes it from the other; removing it from
    confirmed_gaps also clears a (canon-equal) dangling focus."""
    other = "confirmed_gaps" if target == "mastered_concepts" else "mastered_concepts"
    setattr(
        profile,
        target,
        upsert_entry(
            getattr(profile, target) or [], item,
            evidence_type=evidence_type, stamp=stamp,
        ),
    )
    key = canon(item)
    setattr(
        profile, other,
        [e for e in (getattr(profile, other) or []) if canon(e.name) != key],
    )
    if other == "confirmed_gaps":
        _null_focus_if_removed(profile, item)


def apply_user_patch(
    db: Session,
    session_id: str,
    *,
    add_mastered: str | None = None,
    add_gap: str | None = None,
    knowledge_level: str | None = None,
    subtopic: str | None = None,
    subtopic_level: str | None = None,
) -> TopicProfile:
    if db.get(SessionModel, session_id) is None:
        raise ValueError(f"session not found: {session_id}")
    if add_mastered is not None:
        add_mastered = add_mastered.strip()
        if not add_mastered:
            raise ValueError("item cannot be empty after stripping whitespace")
    if add_gap is not None:
        add_gap = add_gap.strip()
        if not add_gap:
            raise ValueError("item cannot be empty after stripping whitespace")
    profile = load_profile(db, session_id)
    if add_mastered is not None:
        add_exclusive(
            profile, "mastered_concepts", add_mastered,
            stamp=datetime.now(timezone.utc),
        )
    if add_gap is not None:
        add_exclusive(
            profile, "confirmed_gaps", add_gap,
            stamp=datetime.now(timezone.utc),
        )
    if knowledge_level is not None:
        profile.knowledge_level = knowledge_level
    if (subtopic is None) != (subtopic_level is None):
        raise ValueError("subtopic and subtopic_level must be provided together")
    if subtopic is not None:
        key = canon(subtopic)
        if not key:
            raise ValueError("item cannot be empty after stripping whitespace")
        levels = dict(profile.subtopic_levels or {})
        if key not in levels:
            raise ValueError("unknown subtopic; subtopics are created by the tutor")
        levels[key] = subtopic_level
        profile.subtopic_levels = levels
    save_profile(db, session_id, profile)
    return profile


def remove_profile_item(
    db: Session,
    session_id: str,
    list_name: Literal["mastered_concepts", "confirmed_gaps"],
    item: str,
) -> TopicProfile:
    profile = load_profile(db, session_id)
    current = list(getattr(profile, list_name) or [])
    if find_entry(current, item) is None:
        raise KeyError(item)
    key = canon(item)
    setattr(profile, list_name, [e for e in current if canon(e.name) != key])
    if list_name == "confirmed_gaps":
        _null_focus_if_removed(profile, item)
    save_profile(db, session_id, profile)
    return profile


def remove_subtopic(db: Session, session_id: str, subtopic: str) -> TopicProfile:
    profile = load_profile(db, session_id)
    levels = dict(profile.subtopic_levels or {})
    key = canon(subtopic)
    if key not in levels:
        raise KeyError(subtopic)
    del levels[key]
    profile.subtopic_levels = levels
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

    # F-21: "tested" provenance is reserved for the server's own grading path
    # (record_from_answer). An agent-supplied "tested" is a self-attested
    # claim, so it is recorded as "declared".
    evidence = "declared" if args.evidence_type == "tested" else args.evidence_type

    profile = load_profile(db, ctx.session_id)

    if (args.subtopic is None) != (args.subtopic_level is None):
        return ToolResult(
            ok=False,
            status="failed",
            error="subtopic and subtopic_level must be provided together",
        )
    if args.subtopic is not None:
        key = canon(args.subtopic)
        if not key:
            return ToolResult(ok=False, status="failed", error="subtopic is empty")
        levels = dict(profile.subtopic_levels or {})
        if key not in levels and len(levels) >= MAX_SUBTOPICS:
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    f"subtopic_levels is full ({MAX_SUBTOPICS}); update an "
                    "existing subtopic instead"
                ),
            )
        levels[key] = args.subtopic_level
        profile.subtopic_levels = levels

    prior_focus = profile.focus_target_gap

    if args.knowledge_level is not None:
        if evidence not in ("declared", "tested"):
            # F-39: level changes need the same evidence standard as mastery.
            # (The knowledge diagnostic sets level server-side and does not
            # pass through this function.)
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "knowledge_level change requires evidence_type 'declared' "
                    "or 'tested'"
                ),
            )
        profile.knowledge_level = args.knowledge_level

    if args.add_confirmed_gap:
        gap_evidence = evidence if evidence in ("declared", "tested") else None
        profile.confirmed_gaps = upsert_entry(
            profile.confirmed_gaps or [], args.add_confirmed_gap,
            evidence_type=gap_evidence, stamp=datetime.now(timezone.utc),
        )

    mastered_this_call = False
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
        if evidence in ("declared", "tested"):
            add_exclusive(
                profile, "mastered_concepts", args.add_mastered_concept,
                evidence_type=evidence,
                stamp=datetime.now(timezone.utc),
            )
            mastered_this_call = True

    # focus_target_gap handling.
    # F-23: an omitted focus field is indistinguishable from an explicit null
    # after JSON parsing, so clearing is treated as INTENT only when a reason
    # accompanies it; a patch that merely omits focus leaves focus unchanged.
    clearing = (
        prior_focus is not None
        and args.focus_target_gap is None
        and args.focus_clear_reason is not None
    )
    if clearing:
        if args.focus_clear_reason == "tested_correct" and not _has_correct_event_for(
            db, ctx.session_id, prior_focus
        ):
            # F-02 (decision Q1): the flagship guard rail. "tested_correct" is
            # accepted only when a correct LearningEvent for the focused gap
            # exists in this session (record_from_answer writes one on the
            # human-click grading path). Known limit: other reason labels are
            # accepted on the agent's word.
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "focus_clear_reason 'tested_correct' rejected: no correct "
                    f"check answer recorded for '{prior_focus}' in this session"
                ),
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

    # F-13 review: if this call just mastered a concept, an explicit
    # focus_target_gap resend (canon-equal to that concept) in the elif
    # above must not resurrect a focus that add_exclusive already cleared.
    if mastered_this_call:
        _null_focus_if_removed(profile, args.add_mastered_concept)

    save_profile(db, ctx.session_id, profile)

    return ToolResult(ok=True, status="ok")


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _learning_insights(
    db: Session, session_ids: list[str], now: datetime
) -> tuple[list[ConceptAccuracy], list[WeeklyMasteryPoint]]:
    """Per-concept accuracy + weekly mastery buckets from learning_events.
    Diagnostic probes excluded (NULL purpose kept). Pure SQL + Python."""
    this_monday = _monday(now.date())
    weeks = [this_monday - timedelta(weeks=i) for i in range(11, -1, -1)]
    week_counts: dict[date, int] = {w: 0 for w in weeks}

    if not session_ids:
        return [], [
            WeeklyMasteryPoint(week_start=w, count=0) for w in weeks
        ]

    rows = db.execute(
        select(LearningEvent)
        .where(LearningEvent.session_id.in_(session_ids))
        .where(
            or_(
                LearningEvent.purpose.is_(None),
                LearningEvent.purpose != "diagnostic",
            )
        )
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).scalars().all()

    per: dict[str, dict] = {}
    first_correct: dict[str, datetime] = {}
    for ev in rows:
        entry = per.setdefault(
            ev.gap_tested,
            {"correct": 0, "total": 0, "results": [], "first_session": ev.session_id},
        )
        entry["total"] += 1
        entry["results"].append(ev.correct)
        if ev.correct:
            entry["correct"] += 1
            first_correct.setdefault(ev.gap_tested, aware_utc(ev.created_at))

    for ts in first_correct.values():
        w = _monday(ts.date())
        if w in week_counts:
            week_counts[w] += 1

    concept_accuracy = sorted(
        (
            ConceptAccuracy(
                concept=name,
                correct_count=v["correct"],
                total_count=v["total"],
                accuracy=round(v["correct"] / v["total"], 4),
                last_results=v["results"][-5:],
                first_seen_session_id=v["first_session"],
            )
            for name, v in per.items()
        ),
        key=lambda x: (x.accuracy, x.concept),
    )
    weekly = [WeeklyMasteryPoint(week_start=w, count=week_counts[w]) for w in weeks]
    return concept_accuracy, weekly


def aggregate_for_user(
    db: Session, user_id: str, now: datetime | None = None
) -> AggregateProfileResponse:
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
                concept.name, {"count": 0, "first_seen_session_id": s.id}
            )
            entry["count"] += 1

        for gap in profile.confirmed_gaps or []:
            entry = gap_counts.setdefault(
                gap.name, {"count": 0, "first_seen_session_id": s.id}
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
    concept_accuracy, weekly_mastery = _learning_insights(
        db, session_ids, now or datetime.now(timezone.utc)
    )
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
        concept_accuracy=concept_accuracy,
        weekly_mastery=weekly_mastery,
    )

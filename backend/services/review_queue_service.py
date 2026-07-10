"""SM-2-lite review scheduler (roadmap R2.1).

Pure functions over learning-event rows: no DB session, no LLM, clock
injected. The route layer maps ORM rows to EventRow so this module stays
free of SQLAlchemy imports.

Interval rule: streak = trailing consecutive correct answers for a concept.
streak == 0 (last answer incorrect) -> due BASE_INTERVAL_DAYS after the last
event; streak >= 1 -> BASE_INTERVAL_DAYS * 2^(streak-1) days, capped at
MAX_INTERVAL_DAYS. A mastered-then-demoted concept re-enters at the reset
interval automatically because the demotion event is an incorrect answer
(roadmap R2.1 AC3).

Concept identity: gap_tested strings are free-text and exact-match across
sessions, so grouping uses a strip().casefold() key; the displayed concept
string and source session come from the group's most recent event.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

BASE_INTERVAL_DAYS = 1
MAX_INTERVAL_DAYS = 60


@dataclass(frozen=True)
class EventRow:
    concept: str
    correct: bool
    created_at: datetime  # timezone-aware UTC
    session_id: str
    topic: str


@dataclass(frozen=True)
class ScheduleEntry:
    concept: str
    source_session_id: str
    source_topic: str
    last_tested_at: datetime
    streak: int
    due_at: datetime


def _interval_days(streak: int) -> int:
    if streak <= 0:
        return BASE_INTERVAL_DAYS
    return min(BASE_INTERVAL_DAYS * 2 ** (streak - 1), MAX_INTERVAL_DAYS)


def compute_schedule(
    events: Sequence[EventRow], now: datetime
) -> list[ScheduleEntry]:
    """Return concepts due for review at `now`, most overdue first."""
    groups: dict[str, list[EventRow]] = {}
    for ev in events:
        key = ev.concept.strip().casefold()
        if not key:
            continue
        groups.setdefault(key, []).append(ev)

    due: list[ScheduleEntry] = []
    for group in groups.values():
        ordered = sorted(group, key=lambda e: e.created_at)
        streak = 0
        for ev in reversed(ordered):
            if not ev.correct:
                break
            streak += 1
        last = ordered[-1]
        due_at = last.created_at + timedelta(days=_interval_days(streak))
        if due_at <= now:
            due.append(
                ScheduleEntry(
                    concept=last.concept,
                    source_session_id=last.session_id,
                    source_topic=last.topic,
                    last_tested_at=last.created_at,
                    streak=streak,
                    due_at=due_at,
                )
            )
    due.sort(key=lambda e: e.due_at)
    return due

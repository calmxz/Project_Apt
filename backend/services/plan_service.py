"""Metered LLM study-plan drafting.

One LiteLLM call produces an ordered lesson list, bounded 3-12 on LLM success; a single-lesson fallback is returned otherwise.
Routed through the existing cost meter and daily cap exactly like a tutor turn
(see agent/tutor.py). Returns drafts only; the route persists them. Any LLM
failure, parse failure, or cap-reached condition falls back to a single lesson
titled after the subject so subject creation never hard-fails.
"""

import json
import logging

import litellm
from sqlalchemy.orm import Session

from config import settings
from contracts import LessonDraft
from services import cost_meter

log = logging.getLogger(__name__)


def _sanitize_for_log(value: object) -> str:
    """Strip CR/LF so a user-derived value cannot forge extra log lines."""
    return str(value).replace("\r", "").replace("\n", "")


MIN_LESSONS = 3
MAX_LESSONS = 12

DRAFT_SYSTEM = (
    "You are a study planner. Given a subject, produce an ordered list of lessons "
    "that build on each other. Return ONLY a JSON array of objects, each "
    '{"title": str, "goal": str}. Between 3 and 12 lessons. "goal" is one short '
    "line on what the learner gets from the lesson."
)


def _duration_instruction(
    duration_mode: str, timeline_days: int | None, pace_per_week: int | None
) -> str:
    if duration_mode == "deadline":
        return (
            f"The learner has a deadline of {timeline_days} days. Fit the lessons "
            "to that horizon: fewer, broader lessons for a short deadline; more, "
            "finer lessons for a long one. Stay within 3-12 lessons."
        )
    return (
        f"The learner wants a steady cadence of about {pace_per_week} lessons per "
        "week with no fixed deadline. Size the list by the subject's natural "
        "breadth (cadence does NOT cap the total). Stay within 3-12 lessons."
    )


def _fallback(title: str) -> list[LessonDraft]:
    return [LessonDraft(title=title, goal=f"Introduction to {title}.")]


def _parse(content: str) -> list[LessonDraft]:
    data = json.loads(content)
    if not isinstance(data, list):
        raise ValueError("expected a JSON array")
    drafts: list[LessonDraft] = []
    for item in data[:MAX_LESSONS]:
        title = str(item["title"]).strip()[:200]
        goal = str(item.get("goal", "")).strip()[:500]
        if title:
            drafts.append(LessonDraft(title=title, goal=goal))
    if len(drafts) < MIN_LESSONS:
        raise ValueError("too few lessons")
    return drafts


async def draft_plan(
    db: Session,
    user_id: str,
    title: str,
    per_session_minutes: int,
    duration_mode: str,
    timeline_days: int | None,
    pace_per_week: int | None,
) -> list[LessonDraft]:
    if settings.llm_stub_enabled:
        return _fallback(title)

    cap = cost_meter.check_cap(db, user_id)
    if not cap.allowed:
        log.warning("draft_plan: daily cost cap reached for %s; using fallback", _sanitize_for_log(user_id))
        return _fallback(title)

    user_prompt = (
        f"Subject: {title}\n"
        f"Minutes per session: {per_session_minutes}\n"
        f"{_duration_instruction(duration_mode, timeline_days, pace_per_week)}"
    )
    try:
        resp = await litellm.acompletion(
            model=settings.model,
            messages=[
                {"role": "system", "content": DRAFT_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
        )
    except Exception as e:
        log.warning("draft_plan LLM call failed: %s", e)
        return _fallback(title)

    try:
        call_cost = litellm.completion_cost(completion_response=resp) or 0.0
    except Exception as e:
        log.warning("draft_plan completion_cost failed: %s", e)
        call_cost = 0.0
    if call_cost > 0:
        try:
            cost_meter.record_cost(db, user_id, call_cost)
        except Exception as e:
            log.warning("draft_plan record_cost failed: %s", e)

    content = (resp.choices[0].message.content or "").strip()
    try:
        return _parse(content)
    except Exception as e:
        log.warning("draft_plan parse failed: %s", e)
        return _fallback(title)

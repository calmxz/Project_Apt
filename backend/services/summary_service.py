"""Synchronous session summary generation (spec §4.3, §8 L381).

generate_and_persist builds a short prompt over the session's last 30 messages,
calls LiteLLM, writes the result into TopicProfile.last_session_summary, and
sets Session.ended_at. On LLM failure or empty content, falls back to a
mechanical "[auto]" summary built from the last 5 messages.
"""

import logging
from datetime import datetime, timezone

import litellm
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from db.models import ChatMessage, Session as SessionModel
from services import cost_meter, profile_service


log = logging.getLogger(__name__)

SUMMARY_SYSTEM = (
    "Summarize this learning session in 2-3 sentences. Cover what was studied,"
    " what the learner understood, and what gaps remain. Be specific."
)


def _mechanical_fallback(messages: list[ChatMessage]) -> str:
    tail = messages[-5:]
    parts = [f"{m.role}: {m.content[:80]}" for m in tail]
    body = "; ".join(parts) if parts else "no exchanges recorded"
    return ("[auto] " + body)[:400]


async def generate_and_persist(db: Session, session: SessionModel) -> str:
    messages = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.id.desc())
        .limit(30)
    ).scalars().all()
    messages = list(reversed(messages))  # chronological order for the transcript

    profile = profile_service.load_profile(db, session.id)

    transcript = "\n".join(f"{m.role}: {m.content}" for m in messages)
    user_prompt = (
        f"Topic: {session.topic or '(unspecified)'}\n"
        f"Profile: {profile.model_dump_json()}\n\n"
        f"Transcript:\n{transcript or '(no messages)'}"
    )

    summary: str
    if settings.llm_stub_enabled:
        summary = _mechanical_fallback(messages)
    else:
        try:
            resp = await litellm.acompletion(
                model=settings.model,
                temperature=settings.summary_temperature,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM},
                    {"role": "user", "content": user_prompt},
                ],
            )
            content = (resp.choices[0].message.content or "").strip()
            summary = content if content else _mechanical_fallback(messages)
            try:
                cost = litellm.completion_cost(completion_response=resp)
            except Exception as e:
                log.warning("summary completion_cost failed: %s", e)
                cost = 0
            cost_meter.log_call(
                db,
                user_id=session.user_id,
                session_id=session.id,
                purpose="summary",
                model=settings.model,
                cost_usd=cost,
                **cost_meter.extract_usage(resp),
            )
        except Exception as e:
            log.warning("summary LLM failed, using mechanical fallback: %s", e)
            summary = _mechanical_fallback(messages)

    profile.last_session_summary = summary
    profile_service.save_profile(db, session.id, profile)

    session.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)
    return summary


ROLLING_WINDOW = 20
ROLLING_DEBOUNCE = 10
ROLLING_SUMMARY_MAX_CHARS = 1200

ROLLING_SYSTEM = (
    "Summarize the earlier part of this tutoring conversation in 3-5 sentences."
    " Cover what was taught, what the learner asked, and how they performed."
    " Be specific; this context replaces messages no longer visible to the tutor."
)


def rolling_summary_due(total_messages: int, summarized_count: int | None) -> bool:
    dropped = total_messages - ROLLING_WINDOW
    return dropped > 0 and dropped - (summarized_count or 0) >= ROLLING_DEBOUNCE


def _mechanical_rolling(dropped: list[ChatMessage]) -> str:
    parts = [f"{m.role}: {m.content[:60]}" for m in dropped[-8:]]
    return ("[auto-rolling] " + "; ".join(parts))[:ROLLING_SUMMARY_MAX_CHARS]


async def update_rolling_summary(db: Session, session_id: str) -> str | None:
    """Debounced summary of messages that fell out of the last-20 prompt window.

    Writes Session.rolling_summary / rolling_summary_count. Returns the new
    summary, or None when not due or on failure (count untouched so the next
    trigger retries). Never raises: callers run this post-response.
    """
    try:
        session = db.get(SessionModel, session_id)
        if session is None:
            return None
        messages = db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.asc())
        ).scalars().all()
        total = len(messages)
        if not rolling_summary_due(total, session.rolling_summary_count):
            return None
        dropped = messages[: total - ROLLING_WINDOW]

        if settings.llm_stub_enabled:
            summary = _mechanical_rolling(dropped)
        else:
            transcript = "\n".join(f"{m.role}: {m.content[:500]}" for m in dropped)
            # Deliberately uncapped: matches generate_and_persist (end-of-session summary),
            # spend is bounded by the debounce, and this call must never block/fail a turn.
            resp = await litellm.acompletion(
                model=settings.model,
                temperature=settings.summary_temperature,
                messages=[
                    {"role": "system", "content": ROLLING_SYSTEM},
                    {"role": "user", "content": f"Topic: {session.topic or '(unspecified)'}\n\n{transcript}"},
                ],
            )
            content = (resp.choices[0].message.content or "").strip()
            if not content:
                return None
            summary = content[:ROLLING_SUMMARY_MAX_CHARS]
            try:
                cost = litellm.completion_cost(completion_response=resp)
            except Exception as e:  # noqa: BLE001
                log.warning("rolling summary completion_cost failed: %s", e)
                cost = 0
            cost_meter.log_call(
                db,
                user_id=session.user_id,
                session_id=session.id,
                purpose="rolling_summary",
                model=settings.model,
                cost_usd=cost,
                **cost_meter.extract_usage(resp),
            )

        session.rolling_summary = summary
        session.rolling_summary_count = total - ROLLING_WINDOW
        db.commit()
        return summary
    except Exception as e:  # noqa: BLE001 - must never break the caller
        log.warning("rolling summary skipped: %s", e)
        db.rollback()
        return None

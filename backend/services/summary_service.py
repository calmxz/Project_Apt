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
        .order_by(ChatMessage.id.asc())
        .limit(30)
    ).scalars().all()

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

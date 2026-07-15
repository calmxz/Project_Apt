"""Synchronous session summary generation (spec §4.3, §8 L381).

generate_and_persist builds a short prompt over the session's last 30 messages,
calls LiteLLM, then force-skips any open check batch and writes the result
into TopicProfile.last_session_summary in a single commit; the caller claims
Session.ended_at first (see routes/sessions.py `_claim_end`). On LLM failure
or empty content, falls back to a mechanical "[auto]" summary built from the
last 5 messages.
"""

import logging

import litellm
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from db.models import ChatMessage, Session as SessionModel
from services import check_question_service, cost_meter, profile_service


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


async def generate_and_persist(
    db: Session, session: SessionModel, *, allow_llm: bool = True
) -> str:
    """allow_llm=False (rate-limited caller) or a breached hard cost cap
    short-circuits to the mechanical summary -- an end must always succeed,
    but must not spend (F-03).

    Does NOT set Session.ended_at -- the caller must claim the end first (see
    routes/sessions.py `_claim_end`, F-30). After the summary is computed,
    force-skips any open check batch and writes the summary in a single
    commit (F-31, F-33)."""
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
    if settings.llm_stub_enabled or not messages:
        # F-32: an empty transcript has nothing to summarize -- never pay for
        # an LLM call, never persist hallucinated prose about it.
        summary = _mechanical_fallback(messages)
    elif not allow_llm or not cost_meter.check_cap(db, session.user_id).allowed:
        # F-03: the summary LLM call is real spend and must respect the same
        # daily ledger and rate limit the chat path is gated on.
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
                timeout=settings.summary_timeout_s,
            )
            content = (resp.choices[0].message.content or "").strip()
            summary = content if content else _mechanical_fallback(messages)
            try:
                cost = litellm.completion_cost(completion_response=resp)
            except Exception as e:
                log.warning("summary completion_cost failed: %s", e)
                try:
                    pt = litellm.token_counter(
                        model=settings.model,
                        messages=[
                            {"role": "system", "content": SUMMARY_SYSTEM},
                            {"role": "user", "content": user_prompt},
                        ],
                    )
                    cost = cost_meter.estimate_cancelled_cost(settings.model, content, pt)
                except Exception as e2:  # noqa: BLE001
                    log.warning("summary cost fallback failed: %s", e2)
                    cost = 0
            cost_meter.record_cost(db, session.user_id, cost)
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

    # F-33: single write window AFTER the LLM await. Abandon any open check
    # batch (F-31 -- resume-create reaches here too) and persist the summary
    # in one commit. ended_at is NOT written here: the caller's _claim_end
    # owns it (F-30) and has already committed it. Cost-ledger writes above
    # (record_cost, log_call) are NOT independently committed -- record_cost
    # only flushes and log_call uses a savepoint (db.begin_nested()); both
    # publish only when this function's db.commit() below runs, alongside the
    # abandon + summary write. If that commit fails, the spend rolls back
    # with it -- same atomicity as the pre-refactor code, and if it fails
    # after the claim above already won, the session is left ended with no
    # summary and any open check batch still open; that is an honest state
    # (versus the old partial-write windows) -- subsequent end calls take the
    # idempotent replay path and do not retry this write.
    check_question_service.abandon_open_batch(db, session.id, commit=False)
    profile.last_session_summary = summary
    profile_service.save_profile(db, session.id, profile, commit=False)
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
            if not cost_meter.check_cap(db, session.user_id).allowed:
                # F-03: capped users skip the rolling summary entirely; count
                # stays untouched so the next uncapped trigger retries.
                return None
            transcript = "\n".join(f"{m.role}: {m.content[:500]}" for m in dropped)
            rolling_messages = [
                {"role": "system", "content": ROLLING_SYSTEM},
                {"role": "user", "content": f"Topic: {session.topic or '(unspecified)'}\n\n{transcript}"},
            ]
            resp = await litellm.acompletion(
                model=settings.model,
                temperature=settings.summary_temperature,
                messages=rolling_messages,
                timeout=settings.summary_timeout_s,
            )
            content = (resp.choices[0].message.content or "").strip()
            # Meter before branching on content: an empty response is still a
            # paid acompletion call and must hit the ledger, not just the
            # non-empty path (previously an empty-content early return here
            # skipped the whole cost block -- tokens spent, nothing billed).
            try:
                cost = litellm.completion_cost(completion_response=resp)
            except Exception as e:
                log.warning("rolling summary completion_cost failed: %s", e)
                try:
                    pt = litellm.token_counter(model=settings.model, messages=rolling_messages)
                    cost = cost_meter.estimate_cancelled_cost(settings.model, content, pt)
                except Exception as e2:  # noqa: BLE001
                    log.warning("rolling summary cost fallback failed: %s", e2)
                    cost = 0
            cost_meter.record_cost(db, session.user_id, cost)
            cost_meter.log_call(
                db,
                user_id=session.user_id,
                session_id=session.id,
                purpose="rolling_summary",
                model=settings.model,
                cost_usd=cost,
                **cost_meter.extract_usage(resp),
            )
            if not content:
                return None
            summary = content[:ROLLING_SUMMARY_MAX_CHARS]

        session.rolling_summary = summary
        session.rolling_summary_count = total - ROLLING_WINDOW
        db.commit()
        return summary
    except Exception as e:  # noqa: BLE001 - must never break the caller
        log.warning("rolling summary skipped: %s", e)
        db.rollback()
        return None

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, literal, select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from agent import context_budget, prompts, tutor
from agent.excerpt import wrap_chunk
from agent.types import ToolContext
from config import settings
from contracts import ChatRequest, Citation
from db.database import SessionLocal, get_db
from db.models import ChatMessage, Document, Session as SessionModel, User
from lib import keyword_index
from lib.error_codes import DAILY_CAP_REACHED, DAILY_COST_CAP_REACHED
from services import (
    check_question_service,
    cost_meter,
    documents_service,
    learning_event_service,
    pending_check_store,
    profile_service,
    rate_limit,
    retrieval_service,
    summary_service,
)
from services.auth import current_user_id
from services.user_service import ensure_user


router = APIRouter(prefix="/api")
log = logging.getLogger(__name__)


async def _rolling_summary_task(session_id: str) -> None:
    """Post-response: refresh the rolling summary if due. Opens its own DB
    session because the request-scoped session is closed by the time
    background tasks run. Must never raise: a failed rolling summary must
    not break a chat turn (the response has already been sent)."""
    db = SessionLocal()
    try:
        await summary_service.update_rolling_summary(db, session_id)
    except Exception as e:  # noqa: BLE001 - never surface to the client
        log.warning("rolling summary task failed: %s", e)
    finally:
        db.close()


def _build_prompt_state(
    *,
    session: SessionModel,
    profile,
    ingestion_status,
    retrieval_required: bool,
    review_gaps: bool,
    review_gap: str | None = None,
    pending_check,
    quiz_cooldown,
    gap_accuracy: dict | None = None,
    prefetched_chunks=None,
) -> dict:
    """Build the prompt_state dict consumed by prompts.build_system_prompt.

    Pure function (no DB access) so it can be unit-tested directly.
    """
    prompt_state = {
        "topic": session.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": retrieval_required,
        "diagnostic_required": profile.knowledge_level is None,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
        "rolling_summary": getattr(session, "rolling_summary", None),
        "pending_check": pending_check,
        "quiz_cooldown": quiz_cooldown,
        "gap_accuracy": gap_accuracy or {},
    }
    if review_gaps:
        gaps = profile_service.concept_names(profile.confirmed_gaps)
        mastered = [
            c
            for c in profile_service.concept_names(profile.mastered_concepts)
            if c not in gaps
        ]
        pool = gaps + mastered
        if pool:
            if review_gap in pool:
                target = review_gap
            else:
                # Requested review_gap isn't in the pool (e.g. resolved/renamed
                # since the queue was fetched): fall back to the first
                # confirmed gap, deliberately preferring gaps over mastered
                # retention concepts as the substitute target.
                target = gaps[0] if gaps else pool[0]
            prompt_state["review_gaps_target"] = target
            prompt_state["review_gaps_retention"] = target in mastered
            prompt_state["diagnostic_required"] = False
    if prefetched_chunks:
        prompt_state["prefetched_excerpts"] = [
            wrap_chunk(ch) for ch in prefetched_chunks
        ]
    return prompt_state


async def _prepare_turn(
    req: ChatRequest,
    user_id: str,
    db: Session,
) -> tuple[list[dict], str, ToolContext]:
    """Pre-flight for /chat/stream.

    Guard order: cost cap -> session 404/409 -> ensure_user -> rate limit.
    The session guard runs before ensure_user and the rate limiter so a
    rejected turn (unknown/foreign session 404, ended session 409) neither
    creates a user row nor consumes a daily rate-limit slot. ensure_user runs
    before check_and_increment so the FK-bearing usage_counters insert never
    races ahead of the users row it references (F-36); check_and_increment's
    internal commit persists both together. Loads history, builds the system
    prompt, then persists the user ChatMessage last (committed before
    returning so it survives even if the stream ends early), and returns
    (messages, system_prompt, ctx).
    """
    # 1) Combined guard read: today's spend + user existence, one statement.
    exists_subq = select(literal(True)).where(User.id == user_id).exists()
    spend_raw, user_exists = db.execute(
        select(cost_meter.spend_subquery(user_id), exists_subq)
    ).one()

    cost_status = cost_meter.check_cap_from_spend(Decimal(str(spend_raw or 0)))
    if not cost_status.allowed:
        raise HTTPException(  # unchanged detail payload
            status_code=429,
            detail={
                "code": DAILY_COST_CAP_REACHED,
                "soft_cap_usd": str(cost_status.soft_cap),
                "hard_cap_usd": str(cost_status.hard_cap),
                "used_usd": str(cost_status.used),
                "resets_at": cost_meter.midnight_utc_iso(),
            },
        )

    # 2) Session + ingestion counts in one statement. Runs BEFORE the rate
    # limiter so a rejected turn (foreign 404 / ended 409) does not consume
    # a daily slot (Batch-1 deferral), and before ensure_user so bogus
    # session ids don't create user rows.
    doc_base = select(func.count()).where(Document.session_id == req.session_id)
    row = db.execute(
        select(
            SessionModel,
            doc_base.scalar_subquery().label("doc_total"),
            doc_base.where(Document.status == "pending").scalar_subquery().label("doc_pending"),
            doc_base.where(Document.status == "ready").scalar_subquery().label("doc_ready"),
        ).where(SessionModel.id == req.session_id)
    ).first()
    if row is None or row[0].user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    session = row[0]
    if session.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})
    ingestion_status = documents_service.status_from_counts(
        row.doc_total, row.doc_pending, row.doc_ready
    )
    # Detach: ensure_user/check_and_increment commit below would otherwise
    # expire this already-fully-loaded row (expire_on_commit), forcing a
    # refresh SELECT the first time a column is read afterwards. All later
    # reads of `session` are plain columns already fetched by the SELECT
    # above, so detaching is safe and keeps the reorder statement-count
    # neutral (Task 3).
    db.expunge(session)

    # 3) First-turn-ever: create the user row BEFORE the usage-counter
    # insert whose FK references it (F-36). check_and_increment's internal
    # commit persists both together.
    if not user_exists:
        ensure_user(db, user_id)

    # 4-5) Rate limit: 2 statements on the allowed path (Task 3).
    allowed, used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        raise HTTPException(  # unchanged detail payload
            status_code=429,
            detail={
                "code": DAILY_CAP_REACHED,
                "cap": settings.daily_cap,
                "used": used,
                "resets_at": rate_limit.midnight_utc_iso(),
            },
        )

    # 6) History through prompt build. An unexpected crash here must not lose
    # the user's message (before the P3.1 consolidation it was persisted
    # up-front): persist it, then re-raise. Happy path pays no extra statement.
    try:
        history = db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == req.session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(20)
        ).scalars().all()
        history = list(reversed(history))

        # P2: cap each history message; the current user message (appended below)
        # and the system prompt are exempt.
        messages = [
            {"role": m.role, "content": context_budget.truncate_message(m.content)}
            for m in history
        ]
        messages.append({"role": "user", "content": req.message})

        profile = profile_service.profile_from_row(session)

        # D1.2: per-gap accuracy, best-effort. Only run when there is something
        # to enrich (confirmed_gaps non-empty) to keep the no-gaps path inside
        # the P3.1 budget; a failure here must never kill the turn.
        gap_accuracy: dict[str, dict] = {}
        if profile.confirmed_gaps:
            try:
                gap_accuracy = learning_event_service.gap_accuracy(db, req.session_id)
            except Exception as e:  # noqa: BLE001 - best-effort prompt enrichment
                log.warning("gap_accuracy failed; continuing without it: %s", e)

        retrieval_required = keyword_index.match_required(
            req.message, json.loads(session.kw_index_json or "[]")
        )
        if not retrieval_required:
            retrieval_required = await retrieval_service.semantic_fallback_required(
                db, req.session_id, req.message, user_id=user_id
            )

        prefetched_chunks = None
        if retrieval_required:
            prefetched_chunks = await retrieval_service.prefetch_for_prompt(
                db, req.session_id, user_id, req.message
            )

        prompt_state = _build_prompt_state(
            session=session,
            profile=profile,
            ingestion_status=ingestion_status,
            retrieval_required=retrieval_required,
            review_gaps=getattr(req, "review_gaps", False),
            review_gap=getattr(req, "review_gap", None),
            pending_check=pending_check_store.get_pending_check_from_row(session),
            quiz_cooldown=check_question_service.get_quiz_cooldown_from_row(session),
            gap_accuracy=gap_accuracy,
            prefetched_chunks=prefetched_chunks,
        )
        system_prompt = prompts.build_system_prompt(prompt_state)
    except Exception:
        db.rollback()
        db.add(ChatMessage(session_id=req.session_id, role="user", content=req.message))
        db.commit()
        raise

    # 7) Persist the user turn LAST (still committed before returning, so it
    # survives an early stream end) - after all reads, so commit-expiry does
    # not trigger a refresh SELECT.
    user_msg = ChatMessage(session_id=req.session_id, role="user", content=req.message)
    db.add(user_msg)
    db.commit()

    ctx = ToolContext(
        db=db,
        session_id=req.session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
        diagnostic_required=bool(prompt_state.get("diagnostic_required", False)),
        prefetched_citations=(
            [
                Citation(
                    doc_id=str(ch.get("doc_id", "")),
                    text=ch.get("text", ""),
                    page=ch.get("page"),
                    doc_name=ch.get("doc_name"),
                )
                for ch in prefetched_chunks
            ]
            if prefetched_chunks
            else None
        ),
    )

    return messages, system_prompt, ctx


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Streaming SSE endpoint. Yields StreamEvent payloads as text/event-stream.

    Pre-flight (_prepare_turn) runs synchronously before StreamingResponse is
    returned, so HTTPException(404/429) surfaces as normal JSON error responses.
    run_streaming owns persistence of the assistant ChatMessage on both normal
    completion and cancellation.
    """
    t0 = time.perf_counter()
    messages, system_prompt, ctx = await _prepare_turn(req, user_id, db)
    prepare_ms = (time.perf_counter() - t0) * 1000.0

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        first_token_logged = False

        async def produce():
            try:
                async for event in tutor.run_streaming(messages, system_prompt, ctx):
                    await queue.put(event)
            finally:
                await queue.put(None)  # sentinel

        task = asyncio.create_task(produce())
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield event.to_sse()
                if settings.debug_timing and not first_token_logged:
                    first_token_logged = True
                    log.info(
                        "chat timing prepare_ms=%.1f first_token_ms=%.1f",
                        prepare_ms,
                        (time.perf_counter() - t0) * 1000.0,
                    )
                if event.type in ("done", "error", "cancelled"):
                    break
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    # Producer cancelled or errored during disconnect cleanup; suppress.
                    pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
        background=BackgroundTask(_rolling_summary_task, req.session_id),
    )

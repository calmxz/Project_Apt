import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from agent import context_budget, prompts, tutor
from agent.types import ToolContext
from config import settings
from contracts import ChatRequest
from db.database import get_db
from db.models import ChatMessage, Session as SessionModel
from lib import keyword_index
from lib.error_codes import DAILY_CAP_REACHED, DAILY_COST_CAP_REACHED
from services import check_question_service, cost_meter, documents_service, profile_service, rate_limit
from services.auth import current_user_id
from services.user_service import ensure_user


router = APIRouter(prefix="/api")


def _build_prompt_state(
    *,
    session: SessionModel,
    profile,
    ingestion_status,
    retrieval_required: bool,
    review_gaps: bool,
    pending_check,
    quiz_cooldown,
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
        "pending_check": pending_check,
        "quiz_cooldown": quiz_cooldown,
    }
    if review_gaps and profile.confirmed_gaps:
        prompt_state["review_gaps_target"] = profile.confirmed_gaps[0]
        prompt_state["diagnostic_required"] = False
    return prompt_state


async def _prepare_turn(
    req: ChatRequest,
    user_id: str,
    db: Session,
) -> tuple[list[dict], str, ToolContext]:
    """Pre-flight for /chat/stream.

    Checks cost cap and rate limit (raises HTTPException 429 on breach),
    auto-creates User if missing, validates session (raises 404 if absent),
    loads history, persists the user ChatMessage (committed so it survives
    even if the stream ends early), builds the system prompt, and returns
    (messages, system_prompt, ctx).
    """
    cost_status = cost_meter.check_cap(db, user_id)
    if not cost_status.allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": DAILY_COST_CAP_REACHED,
                "soft_cap_usd": str(cost_status.soft_cap),
                "hard_cap_usd": str(cost_status.hard_cap),
                "used_usd": str(cost_status.used),
                "resets_at": cost_meter.midnight_utc_iso(),
            },
        )

    allowed, used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": DAILY_CAP_REACHED,
                "cap": settings.daily_cap,
                "used": used,
                "resets_at": rate_limit.midnight_utc_iso(),
            },
        )

    ensure_user(db, user_id)

    session = db.get(SessionModel, req.session_id)
    if session is None or session.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")

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

    user_msg = ChatMessage(session_id=req.session_id, role="user", content=req.message)
    db.add(user_msg)
    db.commit()

    profile = profile_service.load_profile(db, req.session_id)
    ingestion_status = documents_service.session_ingestion_status(db, req.session_id)

    retrieval_required = keyword_index.match_required(
        req.message, json.loads(session.kw_index_json or "[]")
    )

    prompt_state = _build_prompt_state(
        session=session,
        profile=profile,
        ingestion_status=ingestion_status,
        retrieval_required=retrieval_required,
        review_gaps=getattr(req, "review_gaps", False),
        pending_check=check_question_service.get_pending_check(db, req.session_id),
        quiz_cooldown=check_question_service.get_quiz_cooldown(db, req.session_id),
    )
    system_prompt = prompts.build_system_prompt(prompt_state)

    ctx = ToolContext(
        db=db,
        session_id=req.session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
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
    messages, system_prompt, ctx = await _prepare_turn(req, user_id, db)

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

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
    )

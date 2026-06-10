import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from typing import Literal
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from agent import prompts, tutor
from agent.types import ToolContext
from contracts import (
    CheckAnswerRequest,
    CheckAnswerResponse,
    CheckSkipRequest,
    CheckSkipResponse,
    Citation,
    Message,
    SessionCreateRequest,
    SessionDetail,
    SessionEndResponse,
    SessionEndSummary,
    SessionLibraryPage,
    SessionListItem,
    SessionResponse,
    SessionUpdateRequest,
    ToolCallRecord,
    TopicProfile,
)
from db.database import get_db
from db.models import ChatMessage, Document, Session as SessionModel, User
from services import check_question_service, profile_service, summary_service
from services.auth import current_user_id
from services.session_enrichment import aware_utc as _aware_utc, compute_enrichment

NO_EXCHANGES_TEXT = (
    "This session ended without any exchanges. Start a new session to continue."
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _latest_ingestion_status(db: Session, session_id: str) -> str | None:
    doc = db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()
    return doc.status if doc else None


def _to_response(db: Session, row: SessionModel) -> SessionResponse:
    return SessionResponse(
        id=row.id,
        user_id=row.user_id,
        topic=row.topic,
        topic_profile=profile_service.load_profile(db, row.id),
        created_at=_aware_utc(row.created_at),
        ended_at=_aware_utc(row.ended_at),
        ingestion_status=_latest_ingestion_status(db, row.id),
        pinned=row.pinned,
    )


def _enrich_list_items(db: Session, rows: list[SessionModel]) -> list[SessionListItem]:
    """Build SessionListItems with count, last-activity, progress, and preview.
    Enrichment is computed set-based in services.session_enrichment."""
    enr = compute_enrichment(db, rows)
    return [
        SessionListItem(
            id=r.id,
            topic=r.topic,
            created_at=_aware_utc(r.created_at),
            ended_at=_aware_utc(r.ended_at),
            pinned=r.pinned,
            message_count=enr[r.id].message_count,
            last_activity_at=enr[r.id].last_activity_at,
            last_message_preview=enr[r.id].last_message_preview,
            last_session_summary=enr[r.id].last_session_summary,
            progress=enr[r.id].progress,
        )
        for r in rows
    ]


@router.post(
    "/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    req: SessionCreateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    if req.seed_mode == "resume" and req.prior_session_id is None:
        raise HTTPException(
            status_code=400, detail="prior_session_id required when seed_mode=resume"
        )
    if req.seed_mode == "fresh" and req.prior_session_id is not None:
        raise HTTPException(
            status_code=400, detail="prior_session_id forbidden when seed_mode=fresh"
        )

    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.flush()

    new_id = uuid.uuid4().hex
    profile_json = TopicProfile().model_dump_json()

    if req.seed_mode == "resume":
        prior = db.get(SessionModel, req.prior_session_id)
        if prior is None or prior.user_id != user_id:
            raise HTTPException(status_code=404, detail="prior session not found")
        if prior.ended_at is None:
            await summary_service.generate_and_persist(db, prior)
            db.refresh(prior)
        profile_json = prior.topic_profile_json

    new_session = SessionModel(
        id=new_id,
        user_id=user_id,
        topic=req.topic,
        topic_profile_json=profile_json,
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return _to_response(db, new_session)


@router.get("/sessions", response_model=list[SessionListItem])
def list_sessions(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(SessionModel)
        .where(SessionModel.user_id == user_id)
        .order_by(SessionModel.created_at.desc())
    ).scalars().all()
    return _enrich_list_items(db, rows)


def _load_messages(db: Session, session_id: str, open_message_id: int | None = None) -> list[Message]:
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    ).scalars().all()
    # Preload LearningEvents once iff some message may need reconstruction
    # (no persisted check_batch_json and not the open message). Avoids the
    # former per-item N+1 entirely; skipped when every batch is persisted.
    needs_events = any(
        m.check_batch_json is None and m.id != open_message_id for m in rows
    )
    events = (
        check_question_service.load_session_learning_events(db, session_id)
        if needs_events else []
    )
    out: list[Message] = []
    for m in rows:
        try:
            citations = [Citation(**c) for c in json.loads(m.citations_json or "[]")]
        except (ValueError, TypeError):
            citations = []
        try:
            tool_calls = [ToolCallRecord(**t) for t in json.loads(m.tool_calls_json or "[]")]
        except (ValueError, TypeError):
            tool_calls = []
        # Suppress recap for the message whose batch is still OPEN: the live
        # CheckQuestion card (driven by pending_check) owns that batch until
        # it resolves. Otherwise both cards render for the same batch.
        if m.id == open_message_id:
            check_batch = None
        else:
            check_batch = check_question_service.load_check_batch(db, m, events)
        out.append(
            Message(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=_aware_utc(m.created_at),
                citations=citations,
                tool_calls=tool_calls,
                check_batch=check_batch,
            )
        )
    return out


def _build_end_summary(db: Session, session_id: str, text: str) -> SessionEndSummary:
    cleaned = (text or "").removeprefix("[auto] ").strip()
    if not cleaned or cleaned == "no exchanges recorded":
        return SessionEndSummary(kind="no_exchanges", text=NO_EXCHANGES_TEXT)
    return SessionEndSummary(kind="summary", text=cleaned)


# NOTE: must be declared BEFORE GET /sessions/{session_id} or it is captured as a session lookup.
@router.get("/sessions/library", response_model=SessionLibraryPage)
def list_session_library(
    status: Literal["all", "active", "ended"] = "all",
    q: str | None = None,
    sort: Literal["last_activity", "created", "topic"] = "last_activity",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    base = select(SessionModel).where(SessionModel.user_id == user_id)
    if status == "active":
        base = base.where(SessionModel.ended_at.is_(None))
    elif status == "ended":
        base = base.where(SessionModel.ended_at.is_not(None))
    if q:
        base = base.where(SessionModel.topic.ilike(f"%{q}%"))

    total = db.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar_one()

    if sort == "created":
        ordered = base.order_by(SessionModel.created_at.desc(), SessionModel.id.desc())
    elif sort == "topic":
        ordered = base.order_by(SessionModel.topic.asc(), SessionModel.id.asc())
    else:  # last_activity: order by max(message.created_at), falling back to created_at
        last_act_sub = (
            select(
                ChatMessage.session_id.label("sid"),
                func.max(ChatMessage.created_at).label("la"),
            )
            .group_by(ChatMessage.session_id)
            .subquery()
        )
        ordered = (
            base.outerjoin(last_act_sub, last_act_sub.c.sid == SessionModel.id)
            .order_by(func.coalesce(last_act_sub.c.la, SessionModel.created_at).desc(), SessionModel.id.desc())
        )

    rows = db.execute(ordered.limit(limit).offset(offset)).scalars().all()
    return SessionLibraryPage(
        items=_enrich_list_items(db, rows),
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    pc = check_question_service.get_pending_check(db, row.id)
    # message_id is None until attach_message_id runs (non-streaming run()
    # path, or a narrow race). When None, suppression below cannot fire; the
    # read-time backfill is best-effort and any co-render window is transient.
    open_msg_id = pc.get("message_id") if pc else None
    return SessionDetail(
        id=row.id,
        user_id=row.user_id,
        topic=row.topic,
        topic_profile=profile_service.load_profile(db, row.id),
        created_at=_aware_utc(row.created_at),
        ended_at=_aware_utc(row.ended_at),
        ingestion_status=_latest_ingestion_status(db, row.id),
        messages=_load_messages(db, row.id, open_msg_id),
        pinned=row.pinned,
        pending_check=check_question_service.public_view(pc),
    )


@router.post("/sessions/{session_id}/end", response_model=SessionEndResponse)
async def end_session(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")

    if row.ended_at is not None:
        profile = profile_service.load_profile(db, session_id)
        return SessionEndResponse(
            id=row.id,
            ended_at=_aware_utc(row.ended_at),
            summary=_build_end_summary(db, session_id, profile.last_session_summary or ""),
        )

    summary_text = await summary_service.generate_and_persist(db, row)
    db.refresh(row)
    return SessionEndResponse(
        id=row.id,
        ended_at=_aware_utc(row.ended_at),
        summary=_build_end_summary(db, session_id, summary_text),
    )


@router.post("/sessions/{session_id}/reopen", response_model=SessionResponse)
def reopen_session(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    if row.ended_at is not None:
        row.ended_at = None
        db.commit()
        db.refresh(row)
    return _to_response(db, row)


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    req: SessionUpdateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    if req.topic is None and req.pinned is None:
        raise HTTPException(status_code=400, detail="at least one field required")
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    if req.pinned is True and row.ended_at is not None:
        raise HTTPException(status_code=400, detail="cannot pin an ended session")
    if req.topic is not None:
        row.topic = req.topic
    if req.pinned is not None:
        row.pinned = req.pinned
    db.commit()
    db.refresh(row)
    return _to_response(db, row)


@router.post("/sessions/{session_id}/check/skip", response_model=CheckSkipResponse)
def skip_check(
    session_id: str,
    req: CheckSkipRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        prog = check_question_service.skip(db, session_id, req.index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    return CheckSkipResponse(**prog)


@router.post("/sessions/{session_id}/check/answer", response_model=CheckAnswerResponse)
def answer_check(
    session_id: str,
    req: CheckAnswerRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        result = check_question_service.answer(db, session_id, req.index, req.selected_index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    return CheckAnswerResponse(**result)


def _recent_history(db: Session, session_id: str) -> list[dict]:
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    ).scalars().all()
    return [{"role": m.role, "content": m.content} for m in reversed(rows)]


@router.post("/sessions/{session_id}/check/complete")
async def complete_check(
    session_id: str,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Hidden reactive follow-up after a batch fully resolves.

    Builds a server-side results summary, injects it as a NON-persisted synthetic
    user turn, clears the batch, and streams the tutor's reaction. Only the
    assistant reply is persisted (inside run_streaming). Does NOT increment the
    daily rate limit; cost is still metered inside run_streaming.
    """
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")

    pc = check_question_service.get_pending_check(db, session_id)
    if pc is None or not check_question_service.is_done(pc):
        raise HTTPException(status_code=409, detail="no resolved batch to complete")

    summary = check_question_service.build_results_summary(pc)
    cooldown = check_question_service.build_quiz_cooldown(pc)
    check_question_service.write_check_batch(db, pc)
    check_question_service.clear_pending_check(db, session_id)
    check_question_service.set_quiz_cooldown(db, session_id, cooldown)

    profile = profile_service.load_profile(db, session_id)
    latest_doc = db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()
    ingestion_status = latest_doc.status if latest_doc else None

    messages = _recent_history(db, session_id)
    messages.append({"role": "user", "content": summary})

    prompt_state = {
        "topic": row.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": False,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
        "pending_check": None,
        "quiz_cooldown": cooldown,
    }
    system_prompt = prompts.build_system_prompt(prompt_state)
    ctx = ToolContext(
        db=db,
        session_id=session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
        suppress_check=True,
    )

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
                except asyncio.CancelledError:
                    pass  # expected: we just cancelled the producer task
                except Exception:
                    logger.exception(
                        "Unexpected error while cancelling follow-up streaming task"
                    )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

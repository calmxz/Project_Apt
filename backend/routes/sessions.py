import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from agent import prompts, tutor
from agent.stream_events import StreamEvent
from agent.types import ToolContext
from config import settings
from contracts import (
    CheckAnswerRequest,
    CheckAnswerResponse,
    CheckSkipRequest,
    CheckSkipResponse,
    Citation,
    DocumentStatus,
    Message,
    MessagePage,
    SessionCreateRequest,
    SessionDetail,
    SessionEndResponse,
    SessionEndSummary,
    SessionIngestionStatus,
    SessionLibraryPage,
    SessionListItem,
    SessionLookupResult,
    SessionMatch,
    SessionResponse,
    SessionUpdateRequest,
    ToolCallRecord,
    TopicProfile,
)
from db.database import get_db
from db.models import ChatMessage
from db.models import Session as SessionModel
from services import (
    check_question_service,
    cost_meter,
    diagnostic_service,
    documents_service,
    pending_check_store,
    profile_service,
    rate_limit,
    summary_service,
    velocity_limit,
)
from services.auth import accepted_terms_from_request, current_user_id
from services.session_enrichment import aware_utc as _aware_utc
from services.session_enrichment import compute_enrichment
from services.user_service import ensure_user

NO_EXCHANGES_TEXT = (
    "This session ended without any exchanges. Start a new session to continue."
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _to_response(db: Session, row: SessionModel) -> SessionResponse:
    return SessionResponse(
        id=row.id,
        user_id=row.user_id,
        topic=row.topic,
        topic_profile=profile_service.load_profile(db, row.id),
        created_at=_aware_utc(row.created_at),
        ended_at=_aware_utc(row.ended_at),
        ingestion_status=documents_service.session_ingestion_status(db, row.id),
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


def _active_session_on_topic(
    db: Session, user_id: str, topic: str, *, exclude_id: str | None = None
) -> str | None:
    """F-34: id of this user's active (ended_at IS NULL) session with the
    same casefolded topic, else None. The FE guard self-disables on list
    failure and covers only one tab; this is the authoritative check."""
    stmt = (
        select(SessionModel.id)
        .where(
            SessionModel.user_id == user_id,
            SessionModel.ended_at.is_(None),
            func.lower(SessionModel.topic) == (topic or "").strip().lower(),
        )
        .limit(1)
    )
    if exclude_id is not None:
        stmt = stmt.where(SessionModel.id != exclude_id)
    return db.execute(stmt).scalar_one_or_none()


@router.post(
    "/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(velocity_limit.enforce_velocity)],
)
async def create_session(
    req: SessionCreateRequest,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    # C-09: minLength=1 in the contract only rejects "". A whitespace-only
    # topic passes validation and used to be stored as "" after the
    # downstream .strip(). Normalise and reject here, before any side effect
    # (ensure_user, duplicate-topic lookup, prior claim-end, rate limit).
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=422, detail={"code": "empty_topic"})
    req.topic = topic

    if req.seed_mode == "resume" and req.prior_session_id is None:
        raise HTTPException(
            status_code=400, detail="prior_session_id required when seed_mode=resume"
        )
    if req.seed_mode == "fresh" and req.prior_session_id is not None:
        raise HTTPException(
            status_code=400, detail="prior_session_id forbidden when seed_mode=fresh"
        )

    if req.declared_level is not None and req.seed_mode == "resume":
        raise HTTPException(
            status_code=422,
            detail="declared_level forbidden when seed_mode=resume",
        )

    prior, allow_llm, owes_summary = await run_in_threadpool(
        _create_session_claim,
        req,
        user_id,
        db,
        accepted_terms_from_request(request),
    )
    if owes_summary:
        # A resume-triggered summary fires a full-transcript LLM call, so it is
        # counted like a chat turn and the end is claimed first (see
        # _create_session_claim), else a concurrent explicit end double-pays;
        # the open check batch is abandoned inside generate_and_persist
        # (F-03/F-30/F-31).
        await summary_service.generate_and_persist(db, prior, allow_llm=allow_llm)
    return await run_in_threadpool(_create_session_finish, req, user_id, db, prior)


def _create_session_claim(
    req: SessionCreateRequest, user_id: str, db: Session, accepted_terms: bool
):
    """F-11: synchronous guard + prior-claim segment of create_session.

    Order is load-bearing and unchanged: ensure_user -> duplicate-topic 409
    -> prior lookup/claim-end -> rate limit. Returns (prior, allow_llm,
    owes_summary); prior is None unless this is a resume.
    """
    ensure_user(db, user_id, accepted_terms=accepted_terms)

    # This check must run BEFORE the resume block below. The resume block has
    # irreversible side effects (claim-end the prior, consume a rate-limit
    # slot, fire a summary LLM call) -- a pre-existing second active session
    # on this topic must 409 before any of that runs, not after.
    # exclude_id=req.prior_session_id keeps a legitimate resume
    # self-exclusive: the prior being resumed is still active (ended_at IS
    # NULL) here and must not conflict with itself.
    existing = _active_session_on_topic(
        db, user_id, req.topic, exclude_id=req.prior_session_id
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "duplicate_topic", "session_id": existing},
        )

    if req.seed_mode != "resume":
        return None, None, False

    prior = db.get(SessionModel, req.prior_session_id)
    if prior is None or prior.user_id != user_id:
        raise HTTPException(status_code=404, detail="prior session not found")
    if prior.ended_at is None and _claim_end(db, prior.id):
        allow_llm, _ = rate_limit.check_and_increment(db, user_id)
        return prior, allow_llm, True
    return prior, None, False


def _create_session_finish(
    req: SessionCreateRequest, user_id: str, db: Session, prior: SessionModel | None
) -> SessionResponse:
    """F-11: synchronous insert/response segment of create_session."""
    profile_json = TopicProfile(knowledge_level=req.declared_level).model_dump_json()
    if prior is not None:
        db.refresh(prior)
        profile_json = prior.topic_profile_json

    new_session = SessionModel(
        id=uuid.uuid4().hex,
        user_id=user_id,
        topic=req.topic.strip(),
        topic_profile_json=profile_json,
    )
    db.add(new_session)
    try:
        db.commit()
    except IntegrityError as e:
        # B-05: concurrent create raced past the pre-check; the partial
        # unique index is authoritative. Map to the same 409 payload.
        db.rollback()
        existing = _active_session_on_topic(db, user_id, req.topic)
        raise HTTPException(
            status_code=409,
            detail={"code": "duplicate_topic", "session_id": existing},
        ) from e
    db.refresh(new_session)
    return _to_response(db, new_session)


@router.get("/sessions", response_model=list[SessionListItem])
def list_sessions(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    # F-06: unbounded before -- a heavy account loaded (and enriched) every
    # session it had ever created on one request. Default 100 keeps every
    # current caller's behaviour intact.
    rows = db.execute(
        select(SessionModel)
        .where(SessionModel.user_id == user_id)
        .order_by(SessionModel.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).scalars().all()
    return _enrich_list_items(db, rows)


def _load_messages(
    db: Session,
    session_id: str,
    open_message_id: int | None = None,
    before: int | None = None,
    limit: int = 30,
) -> tuple[list[Message], bool]:
    q = select(ChatMessage).where(ChatMessage.session_id == session_id)
    if before is not None:
        q = q.where(ChatMessage.id < before)
    window = list(
        db.execute(q.order_by(ChatMessage.id.desc()).limit(limit + 1)).scalars().all()
    )
    has_more = len(window) > limit
    rows = list(reversed(window[:limit]))
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
                status=m.status,
            )
        )
    return out, has_more


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
    sort: Literal["last_activity", "created", "topic", "pinned_activity"] = "last_activity",
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
    else:  # last_activity / pinned_activity: order by max(message.created_at), falling back to created_at
        last_act_sub = (
            select(
                ChatMessage.session_id.label("sid"),
                func.max(ChatMessage.created_at).label("la"),
            )
            # Without this the aggregate scans every user's messages (a
            # whole-table GROUP BY) just to sort one user's page.
            .where(
                ChatMessage.session_id.in_(
                    select(SessionModel.id).where(SessionModel.user_id == user_id)
                )
            )
            .group_by(ChatMessage.session_id)
            .subquery()
        )
        activity_desc = func.coalesce(last_act_sub.c.la, SessionModel.created_at).desc()
        joined = base.outerjoin(last_act_sub, last_act_sub.c.sid == SessionModel.id)
        if sort == "pinned_activity":
            ordered = joined.order_by(SessionModel.pinned.desc(), activity_desc, SessionModel.id.desc())
        else:
            ordered = joined.order_by(activity_desc, SessionModel.id.desc())

    rows = db.execute(ordered.limit(limit).offset(offset)).scalars().all()
    return SessionLibraryPage(
        items=_enrich_list_items(db, rows),
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/sessions/lookup", response_model=SessionLookupResult)
def lookup_sessions_by_topic(
    topic: str = Query(..., max_length=200),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Case-insensitive exact-match lookup used by the start pages.

    Active match wins; ended match (most recently ended) only when no
    active session matches. Read-only.
    """
    normalized = topic.strip().lower()
    if not normalized:
        return SessionLookupResult()

    def _to_match(row: SessionModel) -> SessionMatch:
        # C-01: tolerant parse. TopicProfile is codegen'd with extra="forbid",
        # so a row written under an older profile schema would 500 the whole
        # lookup under a strict model_validate_json.
        profile = profile_service.profile_from_row(row)
        return SessionMatch(
            session_id=row.id,
            title=row.topic,
            ended_at=row.ended_at,
            gap_count=len(profile.confirmed_gaps),
            knowledge_level=profile.knowledge_level,
        )

    base = db.query(SessionModel).filter(
        SessionModel.user_id == user_id,
        func.lower(func.trim(SessionModel.topic)) == normalized,
    )
    active = (
        base.filter(SessionModel.ended_at.is_(None))
        .order_by(SessionModel.created_at.desc())
        .first()
    )
    if active is not None:
        return SessionLookupResult(active_match=_to_match(active))
    ended = (
        base.filter(SessionModel.ended_at.is_not(None))
        .order_by(SessionModel.ended_at.desc())
        .first()
    )
    if ended is not None:
        return SessionLookupResult(ended_match=_to_match(ended))
    return SessionLookupResult()


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
    messages, has_more = _load_messages(db, row.id, open_msg_id)
    return SessionDetail(
        id=row.id,
        user_id=row.user_id,
        topic=row.topic,
        topic_profile=profile_service.load_profile(db, row.id),
        created_at=_aware_utc(row.created_at),
        ended_at=_aware_utc(row.ended_at),
        ingestion_status=documents_service.session_ingestion_status(db, row.id),
        messages=messages,
        has_more_messages=has_more,
        pinned=row.pinned,
        pending_check=check_question_service.public_view(pc),
    )


@router.get("/sessions/{session_id}/messages", response_model=MessagePage)
def get_session_messages(
    session_id: str,
    before: int = Query(..., description="Exclusive message-id cursor"),
    limit: int = Query(30, ge=1, le=100),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    # Same open-batch recap suppression as get_session: if the open check
    # message ever lands in an older page, the live card still owns it.
    pc = check_question_service.get_pending_check(db, row.id)
    open_msg_id = pc.get("message_id") if pc else None
    items, has_more = _load_messages(db, row.id, open_msg_id, before=before, limit=limit)
    return MessagePage(items=items, has_more=has_more)


def _claim_end(db: Session, session_id: str) -> bool:
    """Atomically claim a session's end (F-30). The conditional UPDATE lets
    exactly one caller win under concurrency (double-click End, End racing a
    continue-topic resume); losers take the idempotent path and never pay a
    second summary LLM call. Committed immediately: the claim must be visible
    to concurrent requests before the multi-second summary await."""
    result = db.execute(
        update(SessionModel)
        .where(SessionModel.id == session_id, SessionModel.ended_at.is_(None))
        .values(ended_at=datetime.now(timezone.utc))
    )
    db.commit()
    return result.rowcount == 1


def _end_session_claim(session_id: str, user_id: str, db: Session):
    """F-11: synchronous 404 guard + end-claim segment of end_session.

    Returns (row, replay_response, warn, allow_llm). replay_response is
    non-None only when the end was already claimed (F-30 idempotent replay);
    in that case the caller must return it without any LLM call.
    """
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")

    if not _claim_end(db, session_id):
        # Already ended, or lost the race to a concurrent end: replay the
        # stored summary; no second LLM call (F-30).
        db.refresh(row)
        profile = profile_service.load_profile(db, session_id)
        warn = cost_meter.cost_warning_header(db, user_id)
        return (
            row,
            SessionEndResponse(
                id=row.id,
                ended_at=_aware_utc(row.ended_at),
                summary=_build_end_summary(
                    db, session_id, profile.last_session_summary or ""
                ),
            ),
            warn,
            None,
        )

    # F-03: an end fires a full-transcript LLM call; count it like a chat
    # turn. At the cap the end still succeeds with a mechanical summary.
    allow_llm, _ = rate_limit.check_and_increment(db, user_id)
    return row, None, None, allow_llm


def _end_session_finish(
    session_id: str, user_id: str, db: Session, row: SessionModel, summary_text: str
):
    """F-11: synchronous post-summary segment of end_session."""
    db.refresh(row)
    warn = cost_meter.cost_warning_header(db, user_id)
    return (
        SessionEndResponse(
            id=row.id,
            ended_at=_aware_utc(row.ended_at),
            summary=_build_end_summary(db, session_id, summary_text),
        ),
        warn,
    )


@router.post(
    "/sessions/{session_id}/end",
    response_model=SessionEndResponse,
    dependencies=[Depends(velocity_limit.enforce_velocity)],
)
async def end_session(
    session_id: str,
    response: Response,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    t0 = time.perf_counter()
    try:
        row, replay, warn, allow_llm = await run_in_threadpool(
            _end_session_claim, session_id, user_id, db
        )
        if replay is not None:
            if warn:
                response.headers["X-Cost-Warning"] = warn
            return replay

        summary_text = await summary_service.generate_and_persist(db, row, allow_llm=allow_llm)
        result, warn = await run_in_threadpool(
            _end_session_finish, session_id, user_id, db, row, summary_text
        )
        if warn:
            response.headers["X-Cost-Warning"] = warn
        return result
    finally:
        if settings.debug_timing:
            logger.info(
                "end_session timing total_ms=%.1f", (time.perf_counter() - t0) * 1000.0
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
        existing = _active_session_on_topic(
            db, user_id, row.topic, exclude_id=row.id
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_topic", "session_id": existing},
            )
        row.ended_at = None
        try:
            db.commit()
        except IntegrityError as e:
            db.rollback()
            existing = _active_session_on_topic(
                db, user_id, row.topic, exclude_id=row.id
            )
            raise HTTPException(
                status_code=409,
                detail={"code": "duplicate_topic", "session_id": existing},
            ) from e
        db.refresh(row)
    return _to_response(db, row)


@router.get("/sessions/{session_id}/ingestion", response_model=SessionIngestionStatus)
def get_session_ingestion(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    docs = documents_service.list_document_statuses(db, session_id)
    return SessionIngestionStatus(
        status=documents_service.aggregate_status(d.status for d in docs),
        documents=[
            DocumentStatus(id=d.id, filename=d.filename, status=d.status, error=d.error)
            for d in docs
        ],
    )


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    req: SessionUpdateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    if req.topic is None and req.pinned is None:
        raise HTTPException(status_code=400, detail="at least one field required")
    if req.topic is not None:
        # C-09: whitespace-only rename would blank the topic. Reject before
        # the row lookup and any mutation.
        topic = req.topic.strip()
        if not topic:
            raise HTTPException(status_code=422, detail={"code": "empty_topic"})
        req.topic = topic
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    if req.pinned is True and row.ended_at is not None:
        raise HTTPException(status_code=400, detail="cannot pin an ended session")
    if req.topic is not None:
        if row.ended_at is None:
            # B-06: rename must honor the same duplicate-active-topic guard
            # as create/reopen; without it a rename reproduces the duplicate
            # state through the front door.
            existing = _active_session_on_topic(
                db, user_id, req.topic, exclude_id=row.id
            )
            if existing is not None:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "duplicate_topic", "session_id": existing},
                )
        row.topic = req.topic.strip()
    if req.pinned is not None:
        row.pinned = req.pinned
    try:
        db.commit()
    except IntegrityError as e:
        # B-05: concurrent rename raced past the pre-check; the partial
        # unique index is authoritative. Map to the same 409 payload.
        # NOTE: use req.topic, not row.topic -- db.rollback() expires the
        # ORM object, so row.topic would reload the pre-rename value from
        # the DB rather than reflecting the attempted (rejected) rename.
        db.rollback()
        existing = _active_session_on_topic(
            db, user_id, req.topic, exclude_id=row.id
        )
        raise HTTPException(
            status_code=409,
            detail={"code": "duplicate_topic", "session_id": existing},
        ) from e
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
    if row.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})
    try:
        prog = check_question_service.skip(db, session_id, req.index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(
            status_code=409, detail={"code": "check_conflict", "message": str(e)}
        ) from e
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    diagnostic_service.grade_if_diagnostic(db, session_id)
    return CheckSkipResponse(**prog)


@router.post(
    "/sessions/{session_id}/check/answer",
    response_model=CheckAnswerResponse,
)
def answer_check(
    session_id: str,
    req: CheckAnswerRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    if row.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})
    try:
        result = check_question_service.answer(db, session_id, req.index, req.selected_index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(
            status_code=409, detail={"code": "check_conflict", "message": str(e)}
        ) from e
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    diagnostic_service.grade_if_diagnostic(db, session_id)
    return CheckAnswerResponse(**result)


def _recent_history(db: Session, session_id: str) -> list[dict]:
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    ).scalars().all()
    return [{"role": m.role, "content": m.content} for m in reversed(rows)]


def _complete_check_prepare(session_id: str, user_id: str, db: Session):
    """F-11: the entire synchronous segment of complete_check.

    Guard/lock/claim order is load-bearing and unchanged. lock_session_row's
    FOR UPDATE and every statement below run on the same Session and the same
    connection, so running the whole segment in one worker thread is
    equivalent to running it inline. Returns
    (allowed, messages, system_prompt, ctx); on `allowed is False` the caller
    emits the daily-cap skip stream and nothing else.
    """
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    if row.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})

    # B-02: claim the batch under the session row lock, so two concurrent
    # /check/complete calls cannot both pass the is_done guard and both fire
    # the paid follow-up turn. The loser blocks until the winner's
    # clear_pending_check commit below, then re-reads an empty batch and 409s;
    # that same commit releases the lock, well before the LLM stream starts.
    profile_service.lock_session_row(db, session_id)
    pc = check_question_service.get_pending_check(db, session_id)
    if pc is None or not check_question_service.is_done(pc):
        raise HTTPException(status_code=409, detail={"code": "no_resolved_batch"})

    summary = check_question_service.build_results_summary(pc)
    cooldown = check_question_service.build_quiz_cooldown(pc)
    # F-24 crash-window backstop: if the per-item grade call never ran (crash
    # between the answer commit and grade), grade the diagnostic NOW, while
    # the resolved batch still exists -- clearing below would otherwise leave
    # knowledge_level None and re-trigger the diagnostic.
    diagnostic_service.grade_if_diagnostic(db, session_id)
    check_question_service.write_check_batch(db, pc)
    pending_check_store.clear_pending_check(db, session_id)
    check_question_service.set_quiz_cooldown(db, session_id, cooldown)

    # S2: the follow-up is a real LLM turn, so it counts against the daily
    # message cap. Grading above is already committed and is never blocked;
    # at the cap we skip only the tutor's reaction.
    allowed, _used = rate_limit.check_and_increment(db, user_id)
    if not allowed:
        return False, None, None, None

    profile = profile_service.load_profile(db, session_id)
    ingestion_status = documents_service.session_ingestion_status(db, session_id)

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
        diagnostic_required=(profile.knowledge_level is None),
    )
    return True, messages, system_prompt, ctx


@router.post(
    "/sessions/{session_id}/check/complete",
    dependencies=[Depends(velocity_limit.enforce_velocity)],
)
async def complete_check(
    session_id: str,
    request: Request,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Hidden reactive follow-up after a batch fully resolves.

    Builds a server-side results summary, injects it as a NON-persisted synthetic
    user turn, clears the batch, and streams the tutor's reaction. Only the
    assistant reply is persisted (inside run_streaming). The follow-up is a real
    LLM turn, so it counts against the daily message cap; grading and batch
    resolution above are never blocked by the cap (see S2).

    F-11: the synchronous DB work lives in _complete_check_prepare and runs in
    a worker thread so it never blocks the event loop.
    """
    allowed, messages, system_prompt, ctx = await run_in_threadpool(
        _complete_check_prepare, session_id, user_id, db
    )
    if not allowed:
        async def skipped_stream():
            yield StreamEvent("followup_skipped", {"reason": "daily_cap"}).to_sse()

        return StreamingResponse(
            skipped_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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

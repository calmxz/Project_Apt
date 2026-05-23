import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import (
    Citation,
    Message,
    SessionCreateRequest,
    SessionDetail,
    SessionEndResponse,
    SessionEndSummary,
    SessionListItem,
    SessionResponse,
    TopicProfile,
)
from db.database import get_db
from db.models import ChatMessage, Document, Session as SessionModel, User
from services import profile_service, summary_service

NO_EXCHANGES_TEXT = (
    "This session ended without any exchanges. Start a new session to continue."
)


router = APIRouter(prefix="/api")


def _aware_utc(dt: datetime | None) -> datetime | None:
    # SQLite drops tzinfo on read even when the column is DateTime(timezone=True).
    # Attach UTC explicitly so Pydantic serializes ISO 8601 with offset; otherwise
    # the frontend's `new Date(iso)` parses the naive string as local time.
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


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
    )


@router.post(
    "/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(req: SessionCreateRequest, db: Session = Depends(get_db)):
    if req.seed_mode == "resume" and req.prior_session_id is None:
        raise HTTPException(
            status_code=400, detail="prior_session_id required when seed_mode=resume"
        )
    if req.seed_mode == "fresh" and req.prior_session_id is not None:
        raise HTTPException(
            status_code=400, detail="prior_session_id forbidden when seed_mode=fresh"
        )

    if not db.get(User, req.user_id):
        db.add(User(id=req.user_id))
        db.flush()

    new_id = uuid.uuid4().hex
    profile_json = TopicProfile().model_dump_json()

    if req.seed_mode == "resume":
        prior = db.get(SessionModel, req.prior_session_id)
        if prior is None or prior.user_id != req.user_id:
            raise HTTPException(status_code=404, detail="prior session not found")
        if prior.ended_at is None:
            await summary_service.generate_and_persist(db, prior)
            db.refresh(prior)
        profile_json = prior.topic_profile_json

    new_session = SessionModel(
        id=new_id,
        user_id=req.user_id,
        topic=req.topic,
        topic_profile_json=profile_json,
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return _to_response(db, new_session)


@router.get("/sessions", response_model=list[SessionListItem])
def list_sessions(user_id: str, db: Session = Depends(get_db)):
    rows = db.execute(
        select(SessionModel)
        .where(SessionModel.user_id == user_id)
        .order_by(SessionModel.created_at.desc())
    ).scalars().all()
    return [
        SessionListItem(
            id=r.id,
            topic=r.topic,
            created_at=_aware_utc(r.created_at),
            ended_at=_aware_utc(r.ended_at),
        )
        for r in rows
    ]


def _load_messages(db: Session, session_id: str) -> list[Message]:
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    ).scalars().all()
    out: list[Message] = []
    for m in rows:
        try:
            citations = [Citation(**c) for c in json.loads(m.citations_json or "[]")]
        except (ValueError, TypeError):
            citations = []
        out.append(
            Message(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=_aware_utc(m.created_at),
                citations=citations,
            )
        )
    return out


def _build_end_summary(db: Session, session_id: str, text: str) -> SessionEndSummary:
    cleaned = (text or "").removeprefix("[auto] ").strip()
    if not cleaned or cleaned == "no exchanges recorded":
        return SessionEndSummary(kind="no_exchanges", text=NO_EXCHANGES_TEXT)
    return SessionEndSummary(kind="summary", text=cleaned)


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: str,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    return SessionDetail(
        id=row.id,
        user_id=row.user_id,
        topic=row.topic,
        topic_profile=profile_service.load_profile(db, row.id),
        created_at=_aware_utc(row.created_at),
        ended_at=_aware_utc(row.ended_at),
        ingestion_status=_latest_ingestion_status(db, row.id),
        messages=_load_messages(db, row.id),
    )


@router.post("/sessions/{session_id}/end", response_model=SessionEndResponse)
async def end_session(
    session_id: str,
    user_id: str = Query(...),
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
    user_id: str = Query(...),
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

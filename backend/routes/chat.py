import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from agent import prompts, tutor
from agent.types import ToolContext
from config import settings
from contracts import ChatRequest, ChatResponse, ToolCallRecord, Citation
from db.database import get_db
from db.models import ChatMessage, Document, Session as SessionModel, User
from lib import keyword_index
from lib.error_codes import DAILY_CAP_REACHED
from services import profile_service, rate_limit
from services.auth import current_user_id


router = APIRouter(prefix="/api")


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
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

    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.flush()

    session = db.get(SessionModel, req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    history = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == req.session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    ).scalars().all()
    history = list(reversed(history))

    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": req.message})

    user_msg = ChatMessage(session_id=req.session_id, role="user", content=req.message)
    db.add(user_msg)
    db.flush()

    profile = profile_service.load_profile(db, req.session_id)
    latest_doc = db.execute(
        select(Document)
        .where(Document.session_id == req.session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()
    ingestion_status = latest_doc.status if latest_doc else None

    retrieval_required = keyword_index.match_required(
        req.message, json.loads(session.kw_index_json or "[]")
    )

    prompt_state = {
        "topic": session.topic,
        "profile": profile,
        "ingestion_status": ingestion_status,
        "retrieval_required": retrieval_required,
        "seed_mode": None,
        "last_session_summary": profile.last_session_summary,
    }
    system_prompt = prompts.build_system_prompt(prompt_state)

    ctx = ToolContext(
        db=db,
        session_id=req.session_id,
        user_id=user_id,
        turn_started_at=datetime.now(timezone.utc),
    )
    reply, tool_calls, citations = await tutor.run(messages, system_prompt, ctx)

    assistant_msg = ChatMessage(
        session_id=req.session_id,
        role="assistant",
        content=reply,
        tool_calls_json=json.dumps([tc.model_dump() for tc in tool_calls]),
        citations_json=json.dumps([c.model_dump() for c in citations]),
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    return ChatResponse(
        assistant_message=reply,
        message_id=assistant_msg.id,
        tool_calls=tool_calls,
        citations=citations,
    )

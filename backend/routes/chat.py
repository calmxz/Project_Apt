from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from agent import prompts, tutor
from db.database import get_db
from db.models import ChatMessage, Session as SessionModel, User
from db.schemas import ChatRequest, ChatResponse
from services import rate_limit

router = APIRouter(prefix="/api")


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    if not rate_limit.check_and_increment(db, req.user_id):
        raise HTTPException(
            status_code=429,
            detail={"message": "Daily cap reached", "reset_at": rate_limit.midnight_utc_iso()},
        )

    if not db.get(User, req.user_id):
        db.add(User(id=req.user_id))
        db.flush()

    if not db.get(SessionModel, req.session_id):
        db.add(SessionModel(id=req.session_id, user_id=req.user_id))
        db.flush()

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

    system_prompt = prompts.build_system_prompt()
    reply = await tutor.run(messages, system_prompt)

    assistant_msg = ChatMessage(session_id=req.session_id, role="assistant", content=reply)
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    return ChatResponse(assistant_message=reply, message_id=assistant_msg.id)

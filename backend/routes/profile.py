from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import LearningEventResponse, ProfileResponse
from db.database import get_db
from db.models import LearningEvent, Session as SessionModel
from services import profile_service


router = APIRouter(prefix="/api")


@router.get("/profile/{session_id}", response_model=ProfileResponse)
def get_profile(session_id: str, db: Session = Depends(get_db)):
    if db.get(SessionModel, session_id) is None:
        raise HTTPException(status_code=404, detail="session not found")

    profile = profile_service.load_profile(db, session_id)
    rows = db.execute(
        select(LearningEvent)
        .where(LearningEvent.session_id == session_id)
        .order_by(LearningEvent.id.desc())
        .limit(20)
    ).scalars().all()
    events = [
        LearningEventResponse(
            id=r.id,
            session_id=r.session_id,
            gap_tested=r.gap_tested,
            question=r.question,
            correct=r.correct,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return ProfileResponse(profile=profile, recent_learning_events=events)

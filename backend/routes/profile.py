from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import (
    AggregateProfileResponse,
    LearningEventResponse,
    ProfileResponse,
)
from db.database import get_db
from db.models import LearningEvent, Session as SessionModel
from services import profile_service
from services.auth import current_user_id


router = APIRouter(prefix="/api")


@router.get("/profile/aggregate", response_model=AggregateProfileResponse)
def get_aggregate_profile(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return profile_service.aggregate_for_user(db, user_id)


@router.get("/profile/{session_id}", response_model=ProfileResponse)
def get_profile(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
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

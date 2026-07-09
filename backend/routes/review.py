from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import ReviewQueueItem, ReviewQueuePage
from db.database import get_db
from db.models import LearningEvent, Session as SessionModel
from services.auth import current_user_id
from services.review_queue_service import EventRow, compute_schedule
from services.session_enrichment import aware_utc

router = APIRouter(prefix="/api")


@router.get("/review/queue", response_model=ReviewQueuePage)
def get_review_queue(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(LearningEvent, SessionModel.topic)
        .join(SessionModel, LearningEvent.session_id == SessionModel.id)
        .where(SessionModel.user_id == user_id)
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).all()
    events = [
        EventRow(
            concept=ev.gap_tested,
            correct=ev.correct,
            created_at=aware_utc(ev.created_at),
            session_id=ev.session_id,
            topic=topic,
        )
        for ev, topic in rows
    ]
    due = compute_schedule(events, now=now)
    return ReviewQueuePage(
        items=[
            ReviewQueueItem(
                concept=e.concept,
                source_session_id=e.source_session_id,
                source_topic=e.source_topic,
                last_tested_at=e.last_tested_at,
                streak=e.streak,
                due_at=e.due_at,
            )
            for e in due[offset : offset + limit]
        ],
        total=len(due),
        limit=limit,
        offset=offset,
    )

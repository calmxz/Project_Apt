from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from contracts import UsageSummaryResponse
from db.database import get_db
from services.auth import current_user_id
from services.usage_service import usage_summary

router = APIRouter(prefix="/api")


@router.get("/usage/summary", response_model=UsageSummaryResponse)
def get_usage_summary(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return usage_summary(db, user_id)

from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from config import settings
from db.models import UsageCounter


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def midnight_utc_iso() -> str:
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow.isoformat()


def check_and_increment(db: Session, user_id: str) -> bool:
    """Return True if the request is allowed, False if the daily cap is reached."""
    date_utc = _today_utc()

    row = db.execute(
        select(UsageCounter).where(
            UsageCounter.user_id == user_id,
            UsageCounter.date_utc == date_utc,
        )
    ).scalar_one_or_none()

    if row is None:
        row = UsageCounter(user_id=user_id, date_utc=date_utc, count=0)
        db.add(row)
        db.flush()

    if row.count >= settings.daily_cap:
        return False

    row.count += 1
    db.commit()
    return True

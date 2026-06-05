from datetime import datetime, timezone

from sqlalchemy import select
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


def check_and_increment(db: Session, user_id: str) -> tuple[bool, int]:
    """Return (allowed, current_used_count_after_call).

    If the cap is already reached, count is not incremented and `allowed=False`.
    Otherwise count is bumped and returned in its post-increment state.
    """
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
        return False, row.count

    row.count += 1
    db.commit()
    return True, row.count

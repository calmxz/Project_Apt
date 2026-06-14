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


def _dialect_insert(db: Session):
    """Return the dialect-specific INSERT that supports ON CONFLICT.

    Both Postgres (prod) and SQLite (tests) implement `on_conflict_do_nothing`;
    the dialect-agnostic `sqlalchemy.insert()` does not.
    """
    name = db.get_bind().dialect.name
    if name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _insert
    else:
        from sqlalchemy.dialects.sqlite import insert as _insert
    return _insert


def check_and_increment(db: Session, user_id: str) -> tuple[bool, int]:
    """Return (allowed, current_used_count_after_call).

    If the cap is already reached, the count is not incremented and
    `allowed=False`. Otherwise the count is bumped and returned post-increment.

    Concurrency-safe: parallel callers for the same (user, day) cannot create
    duplicate rows or exceed the cap. A non-atomic SELECT-then-INSERT loses this
    race (each caller sees no row and INSERTs), which is exactly the bug PR #83's
    parallel reference uploads exposed.

    Step 1 atomically guarantees a single row exists via INSERT ... ON CONFLICT
    DO NOTHING against the `uq_usage_counters_user_date` constraint. Step 2
    increments under a row lock only while strictly below the cap, so the cap
    holds even under contention. `scalar_one()` in step 3 is safe because the
    unique constraint guarantees at most one matching row.
    """
    date_utc = _today_utc()

    insert = _dialect_insert(db)
    db.execute(
        insert(UsageCounter)
        .values(user_id=user_id, date_utc=date_utc, count=0)
        .on_conflict_do_nothing(index_elements=["user_id", "date_utc"])
    )

    result = db.execute(
        update(UsageCounter)
        .where(
            UsageCounter.user_id == user_id,
            UsageCounter.date_utc == date_utc,
            UsageCounter.count < settings.daily_cap,
        )
        .values(count=UsageCounter.count + 1)
    )
    allowed = result.rowcount == 1

    count = db.execute(
        select(UsageCounter.count).where(
            UsageCounter.user_id == user_id,
            UsageCounter.date_utc == date_utc,
        )
    ).scalar_one()

    db.commit()
    return allowed, count

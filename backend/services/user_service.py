"""User-row lifecycle helper.

User rows are created lazily on the first authenticated backend call (Supabase
signUp is client-side; the backend never sees registration). Centralizing the
create here lets us stamp terms acceptance exactly once, at row creation. A row
can only exist after the user signed in, which required passing the
registration consent checkbox, so row-existence corroborates the consent act.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION
from services.sql_dialect import dialect_insert


def ensure_user(db: Session, user_id: str) -> User:
    """Return the users row for user_id, creating it if absent.

    On create, stamp accepted_terms_at (server-owned, tz-aware) and
    terms_version. Existing rows are returned unchanged (no re-stamp).
    Race-safe (F-37): INSERT ... ON CONFLICT DO NOTHING so two concurrent
    first-requests cannot IntegrityError; the loser re-selects the winner's
    row. Writes stay pending until the caller's commit, same as the old
    flush-based version.

    Deviation from the ON CONFLICT recipe used by rate_limit.check_and_increment:
    after the insert we still re-select (needed either way to get an ORM
    row), but on the winning path we then patch accepted_terms_at back to
    the exact tz-aware value we wrote, via set_committed_value (marks it as
    loaded, not dirty -- no spurious UPDATE on next flush). SQLite's
    DateTime(timezone=True) has no native timestamptz and returns a naive
    datetime on read-back (see the round-trip note in
    test_ensure_user_is_idempotent_and_does_not_restamp), so without this
    patch a freshly created row would lose tzinfo on the common path. The
    losing side of a genuine race does not need this: it only asserts on
    the winner's identity/terms fields, not tzinfo fidelity.
    """
    user = db.get(User, user_id)
    if user is not None:
        return user
    now = datetime.now(timezone.utc)
    insert = dialect_insert(db)
    result = db.execute(
        insert(User)
        .values(
            id=user_id,
            accepted_terms_at=now,
            terms_version=CURRENT_TERMS_VERSION,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    created = db.execute(select(User).where(User.id == user_id)).scalar_one()
    if result.rowcount == 1:
        set_committed_value(created, "accepted_terms_at", now)
    return created

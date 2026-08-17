"""User-row lifecycle helper.

User rows are created lazily on the first authenticated backend call. Terms
consent is stamped ONLY when the verified JWT carries the accepted_terms
metadata claim set by the register form (F-52): Supabase signUp is callable
directly, bypassing the client-side checkbox, so row-existence alone does
not evidence consent.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION
from services.sql_dialect import dialect_insert


def ensure_user(db: Session, user_id: str, *, accepted_terms: bool = False) -> User:
    """Return the users row for user_id, creating it if absent.

    On create, stamp accepted_terms_at (server-owned, tz-aware) and
    terms_version ONLY when accepted_terms is True; the caller derives this
    from the verified JWT's accepted_terms metadata claim, not from
    row-existence (F-52). Existing rows are returned unchanged (no
    re-stamp). Race-safe: INSERT ... ON CONFLICT DO NOTHING so two
    concurrent first-requests cannot IntegrityError, and the loser
    re-selects the winner's row (F-37). Writes stay pending until the
    caller's commit.

    After the insert we still re-select (needed either way to get an ORM
    row); on the winning path we then patch accepted_terms_at back to the
    exact tz-aware value we wrote, via set_committed_value (marks it as
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
    stamp = now if accepted_terms else None
    insert = dialect_insert(db)
    result = db.execute(
        insert(User)
        .values(
            id=user_id,
            accepted_terms_at=stamp,
            terms_version=CURRENT_TERMS_VERSION if accepted_terms else None,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    created = db.execute(select(User).where(User.id == user_id)).scalar_one()
    if result.rowcount == 1 and accepted_terms:
        set_committed_value(created, "accepted_terms_at", now)
    return created

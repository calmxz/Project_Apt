"""User-row lifecycle helper.

User rows are created lazily on the first authenticated backend call (Supabase
signUp is client-side; the backend never sees registration). Centralizing the
create here lets us stamp terms acceptance exactly once, at row creation. A row
can only exist after the user signed in, which required passing the
registration consent checkbox, so row-existence corroborates the consent act.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION


def ensure_user(db: Session, user_id: str) -> User:
    """Return the users row for user_id, creating it if absent.

    On create, stamp accepted_terms_at (server-owned, tz-aware) and
    terms_version. Existing rows are returned unchanged (no re-stamp).
    """
    user = db.get(User, user_id)
    if user is not None:
        return user
    user = User(
        id=user_id,
        accepted_terms_at=datetime.now(timezone.utc),
        terms_version=CURRENT_TERMS_VERSION,
    )
    db.add(user)
    db.flush()
    return user

from datetime import datetime, timezone

from db.models import User
from lib.terms import CURRENT_TERMS_VERSION
from services.user_service import ensure_user


def test_ensure_user_creates_and_stamps_acceptance(db_session):
    user = ensure_user(db_session, "new-user", accepted_terms=True)
    db_session.flush()

    assert user.id == "new-user"
    assert user.terms_version == CURRENT_TERMS_VERSION
    assert user.accepted_terms_at is not None
    assert user.accepted_terms_at.tzinfo is not None


def test_ensure_user_is_idempotent_and_does_not_restamp(db_session):
    earlier = datetime(2020, 1, 1, tzinfo=timezone.utc)
    # Strong ref required: SQLAlchemy's identity map is weak; without it the
    # row can be GC'd after flush, ensure_user's db.get reselects, and SQLite
    # (no native timestamptz) returns a naive datetime, breaking the tz-aware
    # compare below for reasons unrelated to ensure_user's correctness.
    existing = User(id="existing", accepted_terms_at=earlier, terms_version="old")
    db_session.add(existing)
    db_session.flush()

    user = ensure_user(db_session, "existing")

    assert user.accepted_terms_at == earlier
    assert user.terms_version == "old"


def test_ensure_user_returns_existing_unstamped_row_untouched(db_session):
    db_session.add(User(id="legacy"))  # created before this feature: nulls
    db_session.flush()

    user = ensure_user(db_session, "legacy")

    assert user.accepted_terms_at is None
    assert user.terms_version is None


def test_ensure_user_without_consent_claim_leaves_stamp_null(db_session):
    user = ensure_user(db_session, "no-claim-user")
    assert user.accepted_terms_at is None
    assert user.terms_version is None


def test_ensure_user_with_consent_claim_stamps(db_session):
    user = ensure_user(db_session, "claimed-user", accepted_terms=True)
    assert user.accepted_terms_at is not None
    assert user.terms_version is not None


def test_ensure_user_lost_insert_race_returns_existing_row(db_session, monkeypatch):
    """F-37: simulate the get-miss/insert-exists race. A row that appears
    between the identity check and the INSERT must be returned unchanged
    (no IntegrityError, no re-stamp)."""
    existing = User(
        id="race-user",
        accepted_terms_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        terms_version="v-old",
    )
    db_session.add(existing)
    db_session.commit()

    # Force the create path even though the row exists.
    real_get = db_session.get
    monkeypatch.setattr(
        db_session,
        "get",
        lambda model, pk: None if (model is User and pk == "race-user") else real_get(model, pk),
    )

    user = ensure_user(db_session, "race-user")
    assert user.id == "race-user"
    assert user.terms_version == "v-old"  # existing stamp preserved

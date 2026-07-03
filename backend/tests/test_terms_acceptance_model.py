from datetime import datetime, timezone

from db.models import User


def test_user_has_acceptance_columns(db_session):
    u = User(
        id="u1",
        accepted_terms_at=datetime(2026, 7, 3, tzinfo=timezone.utc),
        terms_version="2026-07-03",
    )
    db_session.add(u)
    db_session.flush()

    got = db_session.get(User, "u1")
    assert got.accepted_terms_at == datetime(2026, 7, 3, tzinfo=timezone.utc)
    assert got.terms_version == "2026-07-03"


def test_user_acceptance_columns_default_null(db_session):
    u = User(id="u2")
    db_session.add(u)
    db_session.flush()

    got = db_session.get(User, "u2")
    assert got.accepted_terms_at is None
    assert got.terms_version is None

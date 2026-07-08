"""TDD: migration 0010 chains onto the current head (0009)."""

import importlib.util
from pathlib import Path

from db.models import Session as SessionModel, User


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "db" / "alembic" / "versions" / "0010_subjects_lessons.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0010", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_0010_chains_onto_0009():
    mod = _load_migration()
    assert mod.revision == "0010_subjects_lessons"
    assert mod.down_revision == "0009_usage_counter_unique"


def test_session_rolling_summary_columns(db_session):
    """TDD: Session model has rolling_summary and rolling_summary_count columns."""
    user = User(id="test-user")
    db_session.add(user)
    db_session.flush()

    s = SessionModel(id="s-roll", user_id=user.id)
    db_session.add(s)
    db_session.commit()

    assert s.rolling_summary is None
    assert s.rolling_summary_count is None

    s.rolling_summary = "earlier we covered X"
    s.rolling_summary_count = 12
    db_session.commit()

    assert s.rolling_summary == "earlier we covered X"
    assert s.rolling_summary_count == 12

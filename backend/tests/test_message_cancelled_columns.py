"""Tests for chat_messages.status + cancelled_at columns (Task 10).

Validates model-derived schema via in-memory SQLite — no live DB required.
"""
from sqlalchemy import create_engine, inspect
from sqlalchemy.pool import StaticPool

from db.database import Base
import db.models  # noqa: F401 — ensures all models are registered with Base.metadata


def _columns() -> dict:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    insp = inspect(engine)
    return {c["name"]: c for c in insp.get_columns("chat_messages")}


def test_message_has_status_column():
    cols = _columns()
    assert "status" in cols, "chat_messages.status column is missing"
    assert cols["status"]["nullable"] is False, "status must be NOT NULL"


def test_message_has_cancelled_at_column():
    cols = _columns()
    assert "cancelled_at" in cols, "chat_messages.cancelled_at column is missing"
    assert cols["cancelled_at"]["nullable"] is True, "cancelled_at must be nullable"

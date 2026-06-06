"""TDD: sessions.quiz_cooldown_json column + cooldown helpers."""
import uuid

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
import db.models  # noqa: F401 - registers models on Base.metadata
from db.models import Session as SessionModel, User


def _make_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_session_has_quiz_cooldown_column():
    db = _make_session()
    cols = {c["name"] for c in inspect(db.get_bind()).get_columns("sessions")}
    assert "quiz_cooldown_json" in cols

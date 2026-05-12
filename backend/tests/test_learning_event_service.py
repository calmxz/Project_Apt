"""TDD: learning_event_service.record + demotion side effect."""

from datetime import datetime, timezone

import pytest

from agent.types import ToolContext
from contracts import RecordLearningEventArgs, TopicProfile
from db.models import LearningEvent, Session as SessionModel, User
from services import learning_event_service, profile_service


SESSION_ID = "sess_1"
USER_ID = "u1"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile(
                mastered_concepts=["joins"]
            ).model_dump_json(),
        )
    )
    db_session.commit()
    return db_session.get(SessionModel, SESSION_ID)


@pytest.fixture
def ctx(db_session):
    return ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )


def _args(**kw) -> RecordLearningEventArgs:
    kw.setdefault("session_id", SESSION_ID)
    kw.setdefault("gap_tested", "indexes")
    kw.setdefault("question", "what is a btree?")
    kw.setdefault("correct", True)
    return RecordLearningEventArgs(**kw)


def test_correct_event_recorded(session_row, ctx, db_session):
    result = learning_event_service.record(db_session, ctx, _args(correct=True))
    assert result.ok is True
    assert result.status == "ok"
    rows = db_session.query(LearningEvent).all()
    assert len(rows) == 1
    assert rows[0].correct is True


def test_incorrect_on_non_mastered_does_not_demote(session_row, ctx, db_session):
    learning_event_service.record(
        db_session, ctx, _args(gap_tested="indexes", correct=False)
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.mastered_concepts == ["joins"]


def test_incorrect_on_mastered_demotes(session_row, ctx, db_session):
    result = learning_event_service.record(
        db_session, ctx, _args(gap_tested="joins", correct=False)
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "joins" not in profile.mastered_concepts

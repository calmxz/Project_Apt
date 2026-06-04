"""TDD: check_question_service — pending-check state machine."""

from datetime import datetime, timezone, timedelta

import pytest

from contracts import TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq


SESSION_ID = "sess_1"
USER_ID = "u1"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    row = SessionModel(
        id=SESSION_ID,
        user_id=USER_ID,
        topic="biology",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_set_get_clear_pending_check(db_session, session_row):
    s = session_row
    t0 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    assert cq.get_pending_check(db_session, s.id) is None
    cq.set_pending_check(db_session, s.id, gap="calvin_cycle", question="What are the inputs?", asked_at=t0)
    pc = cq.get_pending_check(db_session, s.id)
    assert pc is not None
    assert pc["gap"] == "calvin_cycle"
    assert pc["question"] == "What are the inputs?"
    assert cq.parse_asked_at(pc) == t0
    cq.clear_pending_check(db_session, s.id)
    assert cq.get_pending_check(db_session, s.id) is None


def test_is_gradable_requires_prior_turn(db_session, session_row):
    s = session_row
    asked = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    cq.set_pending_check(db_session, s.id, gap="g", question="q", asked_at=asked)
    same_turn = asked
    later_turn = asked + timedelta(seconds=5)
    assert cq.is_gradable(db_session, s.id, gap="g", current_turn=same_turn) is False
    assert cq.is_gradable(db_session, s.id, gap="g", current_turn=later_turn) is True
    assert cq.is_gradable(db_session, s.id, gap="other", current_turn=later_turn) is False

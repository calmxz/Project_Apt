"""TDD: check_question_service — pending-check state machine."""

from datetime import datetime, timezone, timedelta

import pytest

from agent.types import ToolContext
from contracts import AskCheckQuestionArgs, TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq


SESSION_ID = "sess_1"
USER_ID = "u1"

_T0 = datetime(2026, 6, 4, 0, 0, tzinfo=timezone.utc)


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


# Aliases used by the new MC tests (match plan fixture names)
@pytest.fixture
def db(db_session):
    return db_session


@pytest.fixture
def session_id(session_row):
    return session_row.id


@pytest.fixture
def ctx(db_session, session_row):
    return ToolContext(
        db=db_session,
        session_id=session_row.id,
        user_id=USER_ID,
        turn_started_at=_T0,
    )


def test_set_get_clear_pending_check(db_session, session_row):
    s = session_row
    t0 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    assert cq.get_pending_check(db_session, s.id) is None
    cq.set_pending_check(
        db_session, s.id,
        gap="calvin_cycle", question="What are the inputs?",
        options=["CO2", "O2"], correct_index=0, explanation="CO2 is fixed.",
        asked_at=t0,
    )
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
    cq.set_pending_check(
        db_session, s.id,
        gap="g", question="q",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=asked,
    )
    same_turn = asked
    later_turn = asked + timedelta(seconds=5)
    assert cq.is_gradable(db_session, s.id, gap="g", current_turn=same_turn) is False
    assert cq.is_gradable(db_session, s.id, gap="g", current_turn=later_turn) is True
    assert cq.is_gradable(db_session, s.id, gap="other", current_turn=later_turn) is False


def test_public_view_includes_options_never_answer_fields():
    stored = {
        "gap": "atp_yield",
        "question": "What does glycolysis net per glucose?",
        "options": ["2 ATP", "36 ATP", "0 ATP"],
        "correct_index": 0,
        "explanation": "Net 2 ATP per glucose.",
        "asked_at_turn": "2026-06-04T00:00:00",
    }
    view = cq.public_view(stored)
    assert view == {
        "gap": "atp_yield",
        "question": "What does glycolysis net per glucose?",
        "options": ["2 ATP", "36 ATP", "0 ATP"],
    }
    assert "correct_index" not in view
    assert "explanation" not in view


def test_register_persists_options_and_rejects_bad_correct_index(db, ctx, session_id):
    args = AskCheckQuestionArgs(
        session_id=session_id, gap="g", question="q?",
        options=["a", "b"], correct_index=5, explanation="e",
    )
    bad = cq.register(db, ctx, args)
    assert bad.ok is False
    assert "correct_index" in (bad.error or "")

    ok_args = AskCheckQuestionArgs(
        session_id=session_id, gap="g", question="q?",
        options=["a", "b"], correct_index=1, explanation="b is right",
    )
    res = cq.register(db, ctx, ok_args)
    assert res.ok is True
    stored = cq.get_pending_check(db, session_id)
    assert stored["options"] == ["a", "b"]
    assert stored["correct_index"] == 1
    assert stored["explanation"] == "b is right"
    assert res.data["options"] == ["a", "b"]

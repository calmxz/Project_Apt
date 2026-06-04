"""TDD: ask_check_question tool registers a pending check-question."""

from datetime import datetime, timezone

import pytest

from agent import tools
from agent.types import ToolContext
from contracts import AskCheckQuestionArgs, TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq


SESSION_ID = "sess_acq"
USER_ID = "u_acq"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="biology",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()


@pytest.fixture
def ctx(db_session):
    return ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )


def test_ask_sets_pending_check(db_session, session_row, ctx):
    args = {
        "session_id": ctx.session_id,
        "gap": "calvin_cycle",
        "question": "Inputs?",
        "options": ["CO2 and H2O", "O2 and glucose"],
        "correct_index": 0,
        "explanation": "CO2 is fixed in the Calvin cycle.",
    }
    result = tools.dispatch("ask_check_question", args, ctx)
    assert result.ok is True
    pc = cq.get_pending_check(db_session, ctx.session_id)
    assert pc["gap"] == "calvin_cycle"
    assert cq.parse_asked_at(pc) == ctx.turn_started_at


def test_ask_rejected_when_one_already_open(db_session, session_row, ctx):
    tools.dispatch(
        "ask_check_question",
        {
            "session_id": ctx.session_id,
            "gap": "g1",
            "question": "q1?",
            "options": ["a", "b"],
            "correct_index": 0,
            "explanation": "a.",
        },
        ctx,
    )
    result = tools.dispatch(
        "ask_check_question",
        {
            "session_id": ctx.session_id,
            "gap": "g2",
            "question": "q2?",
            "options": ["a", "b"],
            "correct_index": 0,
            "explanation": "a.",
        },
        ctx,
    )
    assert result.ok is False
    assert "already" in (result.error or "").lower()

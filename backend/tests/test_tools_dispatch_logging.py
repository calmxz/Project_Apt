"""TDD: dispatch logs a WARNING when a tool raises an exception."""

import logging
from datetime import datetime, timezone

import pytest

from agent import tools
from agent.types import ToolContext
from contracts import TopicProfile
from db.models import Session as SessionModel, User


SESSION_ID = "sess_dispatch_log"
USER_ID = "u_dispatch_log"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="math",
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


def test_dispatch_logs_validation_error(caplog, db_session, session_row, ctx):
    # Missing required gap/question/options/correct_index -> ValidationError caught in dispatch.
    bad_args = {"session_id": ctx.session_id}
    with caplog.at_level(logging.WARNING, logger="agent.tools"):
        result = tools.dispatch("ask_check_question", bad_args, ctx)
    assert result.ok is False
    assert any("ask_check_question" in r.message for r in caplog.records)

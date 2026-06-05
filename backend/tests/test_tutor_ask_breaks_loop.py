"""TDD: ask_check_questions terminates the agent loop (turn-breaking behaviour).

When the model calls ask_check_questions and dispatch succeeds, run() must
return immediately without consuming any further LLM responses in that turn.
"""

from datetime import datetime, timezone

import pytest

from agent import tutor
from agent.types import ToolContext
from contracts import TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq


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


@pytest.mark.asyncio
async def test_ask_check_question_terminates_turn(
    db_session, ctx, session_row, mock_litellm, llm_tool_call, llm_text
):
    # Turn 1: model calls ask_check_questions.
    mock_litellm.append(
        llm_tool_call(
            "ask_check_questions",
            {
                "session_id": SESSION_ID,
                "gap": "indexes",
                "items": [
                    {
                        "question": "What is an index?",
                        "options": ["a B-tree structure", "a foreign key"],
                        "correct_index": 0,
                        "explanation": "An index is typically a B-tree structure.",
                    }
                ],
            },
        )
    )
    # Turn 2: would only be reached if the loop did NOT break — must never be consumed.
    mock_litellm.append(llm_text("SHOULD-NOT-APPEAR"))

    reply, tool_calls, citations = await tutor.run(
        messages=[{"role": "user", "content": "quiz me on indexes"}],
        system_prompt="sys",
        ctx=ctx,
    )

    # The "SHOULD-NOT-APPEAR" text must not have leaked into the reply.
    assert "SHOULD-NOT-APPEAR" not in (reply or "")

    # ask_check_questions must appear in tool_calls_record.
    assert any(
        getattr(t, "name", None) == "ask_check_questions" for t in tool_calls
    ), "ask_check_questions not found in tool_calls_record"

    # The pending check must have been persisted.
    pc = cq.get_pending_check(db_session, SESSION_ID)
    assert pc is not None, "pending_check was not set after ask_check_questions"
    assert pc["gap"] == "indexes"
    assert pc["items"][0]["question"] == "What is an index?"

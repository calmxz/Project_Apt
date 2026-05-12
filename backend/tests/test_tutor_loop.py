"""TDD: tutor.run multi-iteration loop, tool dispatch, citations, max_iters."""

from datetime import datetime, timezone

import pytest

from agent import tutor
from agent.types import ToolContext
from contracts import TopicProfile, ToolResult
from db.models import Session as SessionModel, User


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


async def test_single_text_response_no_tools(mock_litellm, llm_text, session_row, ctx):
    mock_litellm.append(llm_text("plain answer"))
    text, tool_calls, citations = await tutor.run(
        messages=[{"role": "user", "content": "hi"}],
        system_prompt="sys",
        ctx=ctx,
    )
    assert text == "plain answer"
    assert tool_calls == []
    assert citations == []


async def test_tool_call_then_text(mock_litellm, llm_text, llm_tool_call, session_row, ctx):
    mock_litellm.append(
        llm_tool_call(
            "update_topic_profile",
            {
                "session_id": SESSION_ID,
                "evidence_type": "declared",
                "add_confirmed_gap": "joins",
            },
        )
    )
    mock_litellm.append(llm_text("noted, want me to teach joins?"))
    text, tool_calls, citations = await tutor.run(
        messages=[{"role": "user", "content": "I don't know joins"}],
        system_prompt="sys",
        ctx=ctx,
    )
    assert text == "noted, want me to teach joins?"
    assert len(tool_calls) == 1
    assert tool_calls[0].name == "update_topic_profile"
    assert tool_calls[0].status == "ok"


async def test_failed_tool_dispatch_surfaces_in_records(
    mock_litellm, llm_text, llm_tool_call, session_row, ctx
):
    # session_id mismatch -> profile_service rejects
    mock_litellm.append(
        llm_tool_call(
            "update_topic_profile",
            {
                "session_id": "wrong",
                "evidence_type": "declared",
                "add_confirmed_gap": "joins",
            },
        )
    )
    mock_litellm.append(llm_text("sorry, retrying differently"))
    text, tool_calls, _ = await tutor.run(
        messages=[{"role": "user", "content": "hi"}],
        system_prompt="sys",
        ctx=ctx,
    )
    assert text == "sorry, retrying differently"
    assert tool_calls[0].status == "failed"
    assert "mismatch" in (tool_calls[0].error or "")


async def test_max_iters_exhausted_returns_fallback(
    mock_litellm, llm_tool_call, session_row, ctx
):
    # Always emit a tool_call -> loop never gets a text response.
    for i in range(20):
        mock_litellm.append(
            llm_tool_call(
                "update_topic_profile",
                {
                    "session_id": SESSION_ID,
                    "evidence_type": "declared",
                    "add_confirmed_gap": f"gap_{i}",
                },
                tool_call_id=f"tc_{i}",
            )
        )
    text, tool_calls, _ = await tutor.run(
        messages=[{"role": "user", "content": "hi"}],
        system_prompt="sys",
        ctx=ctx,
    )
    assert "trouble" in text.lower() or "rephrase" in text.lower()
    assert len(tool_calls) == 8  # max_iters bound


async def test_retrieve_chunks_populates_citations(
    mock_litellm, llm_text, llm_tool_call, session_row, ctx, monkeypatch
):
    fake_chunks = [
        {"doc_id": "1", "text": "An inner join returns matching rows.", "page": 3, "score": 0.9}
    ]
    monkeypatch.setattr(
        "services.retrieval_service.retrieve",
        lambda db, ctx, args: ToolResult(
            ok=True, status="ok", data={"chunks": fake_chunks}
        ),
    )
    mock_litellm.append(
        llm_tool_call(
            "retrieve_chunks",
            {"session_id": SESSION_ID, "query": "inner join", "k": 5},
        )
    )
    mock_litellm.append(llm_text("Inner joins return matching rows [1]."))
    text, tool_calls, citations = await tutor.run(
        messages=[{"role": "user", "content": "what is an inner join?"}],
        system_prompt="sys",
        ctx=ctx,
    )
    assert len(citations) == 1
    assert citations[0].doc_id == "1"
    assert "matching rows" in citations[0].text
    assert tool_calls[0].name == "retrieve_chunks"

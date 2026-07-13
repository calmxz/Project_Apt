"""TDD: summary_service.generate_and_persist."""

import asyncio

import pytest

from contracts import TopicProfile
from db.models import ChatMessage, LlmCallLog, Session as SessionModel, User
from services import profile_service, summary_service


USER_ID = "u1"
SESSION_ID = "s1"


@pytest.fixture
def session_with_messages(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    session = SessionModel(
        id=SESSION_ID,
        user_id=USER_ID,
        topic="sql",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.flush()
    for i in range(3):
        db_session.add(
            ChatMessage(session_id=SESSION_ID, role="user", content=f"msg {i}")
        )
        db_session.add(
            ChatMessage(session_id=SESSION_ID, role="assistant", content=f"resp {i}")
        )
    db_session.commit()
    return session


def test_successful_summary_persists_into_profile(
    session_with_messages, db_session, monkeypatch
):
    from types import SimpleNamespace

    async def fake_acompletion(**kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="a good summary"))]
        )

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    summary = asyncio.run(
        summary_service.generate_and_persist(db_session, session_with_messages)
    )
    assert summary == "a good summary"
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.last_session_summary == "a good summary"
    assert session_with_messages.ended_at is not None


def test_successful_summary_logs_llm_call(
    session_with_messages, db_session, monkeypatch
):
    """Migration 0014: generate_and_persist logs a per-call attribution row
    (purpose="summary") -- additive to whatever cost tracking exists
    elsewhere, log-only (not passed to record_cost, out of scope here).

    Also verifies (Task 4) that token usage on the acompletion response is
    extracted and persisted onto the LlmCallLog row via cost_meter.extract_usage."""
    from types import SimpleNamespace

    async def fake_acompletion(**kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="a good summary"))],
            usage=SimpleNamespace(
                prompt_tokens=50, completion_tokens=10, prompt_tokens_details=None
            ),
        )

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)
    monkeypatch.setattr(
        "services.summary_service.litellm.completion_cost",
        lambda **kwargs: 0.0021,
    )

    asyncio.run(
        summary_service.generate_and_persist(db_session, session_with_messages)
    )

    row = db_session.query(LlmCallLog).filter(LlmCallLog.purpose == "summary").one()
    assert row.session_id == SESSION_ID
    assert row.user_id == USER_ID
    assert row.prompt_tokens == 50
    assert row.completion_tokens == 10
    assert row.cached_tokens is None


def test_llm_exception_uses_mechanical_fallback(
    session_with_messages, db_session, monkeypatch
):
    async def boom(**kwargs):
        raise RuntimeError("upstream down")

    monkeypatch.setattr("services.summary_service.litellm.acompletion", boom)

    summary = asyncio.run(
        summary_service.generate_and_persist(db_session, session_with_messages)
    )
    assert summary.startswith("[auto]")
    assert "msg" in summary or "resp" in summary


def test_empty_messages_still_returns_string(db_session, monkeypatch):
    db_session.add(User(id="u_empty"))
    db_session.flush()
    session = SessionModel(
        id="s_empty",
        user_id="u_empty",
        topic="t",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()

    async def boom(**kwargs):
        raise RuntimeError("fail")

    monkeypatch.setattr("services.summary_service.litellm.acompletion", boom)
    summary = asyncio.run(summary_service.generate_and_persist(db_session, session))
    assert isinstance(summary, str)
    assert len(summary) > 0


def test_summary_uses_last_30_messages(db_session, monkeypatch):
    from types import SimpleNamespace

    db_session.add(User(id="u_last30"))
    db_session.flush()
    session = SessionModel(
        id="s_last30",
        user_id="u_last30",
        topic="sql",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.flush()
    for i in range(1, 41):
        db_session.add(
            ChatMessage(session_id="s_last30", role="user", content=f"marker-{i}")
        )
    db_session.commit()

    captured = {}

    async def fake_acompletion(**kwargs):
        captured["messages"] = kwargs["messages"]
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="a real summary"))]
        )

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)

    asyncio.run(summary_service.generate_and_persist(db_session, session))

    user_prompt = captured["messages"][1]["content"]
    assert "marker-40" in user_prompt  # newest message present
    # marker-1 is a prefix of marker-10..19, so assert on the exact oldest
    # surviving-window boundary instead: with 40 messages and a 30-window,
    # messages 1-10 must have fallen out.
    assert "user: marker-9" not in user_prompt

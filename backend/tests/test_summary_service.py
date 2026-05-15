"""TDD: summary_service.generate_and_persist."""

import asyncio

import pytest

from contracts import TopicProfile
from db.models import ChatMessage, Session as SessionModel, User
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

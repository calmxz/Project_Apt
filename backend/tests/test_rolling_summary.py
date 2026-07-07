"""TDD: summary_service.rolling_summary_due + update_rolling_summary (P2 AC3).

Debounced rolling summary: rolling_summary_count stores how many messages
had already dropped out of the last-ROLLING_WINDOW prompt window at the time
the stored summary ran. Due when at least ROLLING_DEBOUNCE new messages have
dropped since.
"""

import pytest

from contracts import TopicProfile
from db.models import ChatMessage, Session as SessionModel, User
from services import summary_service


USER_ID = "u_roll"


@pytest.fixture
def session_with_messages(db_session):
    """Factory fixture: session_with_messages(n=30) creates a session with n
    alternating user/assistant ChatMessages and returns the Session row."""

    counter = {"n": 0}

    def _make(n: int) -> SessionModel:
        counter["n"] += 1
        session_id = f"s_roll_{counter['n']}"
        db_session.add(User(id=f"{USER_ID}_{counter['n']}"))
        db_session.flush()
        session = SessionModel(
            id=session_id,
            user_id=f"{USER_ID}_{counter['n']}",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
        db_session.add(session)
        db_session.flush()
        for i in range(n):
            role = "user" if i % 2 == 0 else "assistant"
            db_session.add(
                ChatMessage(session_id=session_id, role=role, content=f"msg {i}")
            )
        db_session.commit()
        db_session.refresh(session)
        return session

    return _make


@pytest.mark.parametrize("total,count,expected", [
    (20, None, False),   # nothing dropped yet
    (29, None, False),   # 9 dropped, below debounce
    (30, None, True),    # 10 dropped, due
    (35, 10, False),     # 15 dropped, 10 covered, 5 new -- not due
    (40, 10, True),       # 20 dropped, 10 covered, 10 new -- due
])
def test_rolling_summary_due(total, count, expected):
    assert summary_service.rolling_summary_due(total, count) is expected


async def test_update_rolling_summary_not_due_returns_none(db_session, session_with_messages):
    s = session_with_messages(n=25)
    assert await summary_service.update_rolling_summary(db_session, s.id) is None
    assert s.rolling_summary is None


async def test_update_rolling_summary_writes_summary_and_count(
    db_session, session_with_messages, monkeypatch
):
    s = session_with_messages(n=30)
    monkeypatch.setattr(summary_service.settings, "llm_stub", True)
    result = await summary_service.update_rolling_summary(db_session, s.id)
    assert result is not None
    db_session.refresh(s)
    assert s.rolling_summary == result
    assert s.rolling_summary_count == 10  # 30 - 20 dropped covered
    assert len(s.rolling_summary) <= summary_service.ROLLING_SUMMARY_MAX_CHARS


async def test_update_rolling_summary_llm_failure_skips(
    db_session, session_with_messages, monkeypatch
):
    s = session_with_messages(n=30)
    monkeypatch.setattr(summary_service.settings, "llm_stub", False)

    async def boom(*a, **k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(summary_service.litellm, "acompletion", boom)
    assert await summary_service.update_rolling_summary(db_session, s.id) is None
    db_session.refresh(s)
    assert s.rolling_summary is None
    assert s.rolling_summary_count is None  # unchanged -> next trigger retries

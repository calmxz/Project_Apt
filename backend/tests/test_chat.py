from types import SimpleNamespace

import pytest
from sqlalchemy import select

from config import settings
from contracts import TopicProfile
from db.models import ChatMessage, Session as SessionModel, User
from lib.error_codes import DAILY_CAP_REACHED
from routes.chat import _build_prompt_state


SESSION_ID = "s1"
USER_ID = "u1"
AUTH_HEADERS = {"Authorization": f"Bearer test-{USER_ID}"}


@pytest.fixture(autouse=True)
def seed_session(db_session):
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


def _post_stream(client, session_id=SESSION_ID, message="hello"):
    """POST /api/chat/stream and drain the SSE body. Returns (status, body)."""
    lines = []
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"session_id": session_id, "message": message},
        headers=AUTH_HEADERS,
    ) as resp:
        status = resp.status_code
        if status == 200:
            for line in resp.iter_lines():
                lines.append(line)
    return status, "\n".join(lines)


def test_chat_stream_stub_persists_both_roles(client, db_session, monkeypatch):
    """Integration through the real run_streaming (stub mode): _prepare_turn
    persists the user message and the agent persists the assistant message."""
    monkeypatch.setattr(settings, "llm_stub", True)

    status, body = _post_stream(client, message="hi")
    assert status == 200
    assert "event: assistant_delta" in body
    assert "event: done" in body

    msgs = db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == SESSION_ID)
    ).scalars().all()
    roles = {m.role for m in msgs}
    assert roles == {"user", "assistant"}
    assistant = next(m for m in msgs if m.role == "assistant")
    assert assistant.content.startswith("[STUB:")


def test_gap_accuracy_failure_does_not_kill_turn(client, db_session, monkeypatch):
    """gap_accuracy is best-effort (D1.2): a failure must not kill the turn."""
    monkeypatch.setattr(settings, "llm_stub", True)

    sess = db_session.get(SessionModel, SESSION_ID)
    sess.topic_profile_json = TopicProfile(confirmed_gaps=["frac"]).model_dump_json()
    db_session.commit()

    def _boom(db, sid):
        raise RuntimeError("db exploded")

    monkeypatch.setattr("routes.chat.learning_event_service.gap_accuracy", _boom)

    status, body = _post_stream(client, message="hi")
    assert status == 200
    assert "event: assistant_delta" in body
    assert "event: done" in body


def test_prompt_build_failure_still_persists_user_message(client, db_session, monkeypatch):
    """An unexpected crash while assembling the prompt must not lose the
    user's message: it is persisted before the exception propagates."""
    monkeypatch.setattr(settings, "llm_stub", True)

    def _boom(prompt_state):
        raise RuntimeError("prompt build exploded")

    monkeypatch.setattr("routes.chat.prompts.build_system_prompt", _boom)

    with pytest.raises(RuntimeError, match="prompt build exploded"):
        _post_stream(client, message="save me")

    user_msgs = db_session.execute(
        select(ChatMessage).where(
            ChatMessage.session_id == SESSION_ID, ChatMessage.role == "user"
        )
    ).scalars().all()
    assert [m.content for m in user_msgs] == ["save me"]


def test_chat_stream_429_on_cap(client, monkeypatch):
    monkeypatch.setattr(settings, "llm_stub", True)

    for _ in range(settings.daily_cap):
        status, _body = _post_stream(client, message="x")
        assert status == 200

    r = client.post(
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "x"},
        headers=AUTH_HEADERS,
    )
    assert r.status_code == 429
    detail = r.json()["detail"]
    assert detail["code"] == DAILY_CAP_REACHED
    assert detail["cap"] == settings.daily_cap
    assert detail["used"] == settings.daily_cap
    assert "resets_at" in detail


def _fake_session(topic="sql"):
    return SimpleNamespace(topic=topic)


def _fake_profile(**overrides):
    defaults = {"knowledge_level": "intermediate", "confirmed_gaps": []}
    defaults.update(overrides)
    return TopicProfile(**defaults)


def _call_build_prompt_state(profile, review_gaps, review_gap=None):
    return _build_prompt_state(
        session=_fake_session(),
        profile=profile,
        ingestion_status="none",
        retrieval_required=False,
        review_gaps=review_gaps,
        review_gap=review_gap,
        pending_check=None,
        quiz_cooldown=None,
    )


def test_build_prompt_state_review_gaps_picks_first_gap():
    profile = _fake_profile(confirmed_gaps=["photosynthesis", "krebs cycle"])
    state = _call_build_prompt_state(profile, review_gaps=True)
    assert state["review_gaps_target"] == "photosynthesis"


def test_build_prompt_state_review_gaps_suppresses_diagnostic():
    profile = _fake_profile(knowledge_level=None, confirmed_gaps=["a"])
    state = _call_build_prompt_state(profile, review_gaps=True)
    assert state["review_gaps_target"] == "a"
    assert state["diagnostic_required"] is False


def test_build_prompt_state_review_gaps_off_when_no_gaps():
    profile = _fake_profile(confirmed_gaps=[])
    state = _call_build_prompt_state(profile, review_gaps=True)
    assert "review_gaps_target" not in state


def test_build_prompt_state_review_gaps_off_when_flag_false():
    profile = _fake_profile(confirmed_gaps=["photosynthesis"])
    state = _call_build_prompt_state(profile, review_gaps=False)
    assert "review_gaps_target" not in state


def test_build_prompt_state_preserves_other_keys():
    profile = _fake_profile(confirmed_gaps=[], last_session_summary="summary text")
    state = _call_build_prompt_state(profile, review_gaps=False)
    assert state["topic"] == "sql"
    assert state["profile"] is profile
    assert state["ingestion_status"] == "none"
    assert state["retrieval_required"] is False
    assert state["diagnostic_required"] is False
    assert state["seed_mode"] is None
    assert state["last_session_summary"] == "summary text"
    assert state["pending_check"] is None
    assert state["quiz_cooldown"] is None


def test_review_gap_targets_named_gap():
    profile = _fake_profile(confirmed_gaps=["gap-a", "gap-b", "gap-c"])
    state = _call_build_prompt_state(profile, review_gaps=True, review_gap="gap-b")
    assert state["review_gaps_target"] == "gap-b"


def test_review_gap_invalid_falls_back_to_first():
    profile = _fake_profile(confirmed_gaps=["gap-a", "gap-b", "gap-c"])
    state = _call_build_prompt_state(profile, review_gaps=True, review_gap="not-a-gap")
    assert state["review_gaps_target"] == "gap-a"


def test_review_gap_none_falls_back_to_first():
    profile = _fake_profile(confirmed_gaps=["gap-a", "gap-b", "gap-c"])
    state = _call_build_prompt_state(profile, review_gaps=True, review_gap=None)
    assert state["review_gaps_target"] == "gap-a"


def test_build_prompt_state_carries_rolling_summary():
    """P2 AC3: rolling_summary flows from the session onto the prompt state
    so build_dynamic_context can render it."""
    session = _fake_session()
    session.rolling_summary = "covered limits and continuity"
    profile = _fake_profile()
    state = _build_prompt_state(
        session=session,
        profile=profile,
        ingestion_status="none",
        retrieval_required=False,
        review_gaps=False,
        pending_check=None,
        quiz_cooldown=None,
    )
    assert state["rolling_summary"] == "covered limits and continuity"


def test_build_prompt_state_rolling_summary_defaults_none():
    state = _call_build_prompt_state(_fake_profile(), review_gaps=False)
    assert state["rolling_summary"] is None


def test_resumed_profile_skips_diagnostic():
    """R1.1 AC2: a resume-seeded profile carries a non-null knowledge_level,
    so the 3Q diagnostic branch must not be taken."""
    profile = _fake_profile(knowledge_level="intermediate", confirmed_gaps=["gap-a"])
    state = _call_build_prompt_state(profile, review_gaps=False)
    assert state["diagnostic_required"] is False

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


def test_chat_persists_messages(client, mock_litellm):
    response = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "hello"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["assistant_message"] == "This is a mocked tutor response."
    assert isinstance(data["message_id"], int)


def test_chat_persists_both_roles(client, db_session, mock_litellm):
    client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "hi"},
    )
    msgs = db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == SESSION_ID)
    ).scalars().all()
    roles = {m.role for m in msgs}
    assert roles == {"user", "assistant"}


def test_chat_429_on_cap(client, mock_litellm):
    for _ in range(settings.daily_cap):
        r = client.post(
            "/api/chat",
            json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "x"},
        )
        assert r.status_code == 200
    r = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "x"},
    )
    assert r.status_code == 429
    detail = r.json()["detail"]
    assert detail["code"] == DAILY_CAP_REACHED
    assert detail["cap"] == settings.daily_cap
    assert detail["used"] == settings.daily_cap
    assert "resets_at" in detail


def test_chat_404_when_session_missing(client, mock_litellm):
    r = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": "does_not_exist", "message": "x"},
    )
    assert r.status_code == 404


def _fake_session(topic="sql"):
    return SimpleNamespace(topic=topic)


def _fake_profile(**overrides):
    defaults = {"knowledge_level": "intermediate", "confirmed_gaps": []}
    defaults.update(overrides)
    return TopicProfile(**defaults)


def _call_build_prompt_state(profile, review_gaps):
    return _build_prompt_state(
        session=_fake_session(),
        profile=profile,
        ingestion_status="none",
        retrieval_required=False,
        review_gaps=review_gaps,
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

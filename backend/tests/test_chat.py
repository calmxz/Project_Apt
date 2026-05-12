import pytest
from sqlalchemy import select

from config import settings
from contracts import TopicProfile
from db.models import ChatMessage, Session as SessionModel, User


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
    assert "reset_at" in r.json()["detail"]


def test_chat_404_when_session_missing(client, mock_litellm):
    r = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": "does_not_exist", "message": "x"},
    )
    assert r.status_code == 404

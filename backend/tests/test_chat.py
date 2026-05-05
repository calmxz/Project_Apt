from sqlalchemy import select

from config import settings
from db.models import ChatMessage


def test_chat_persists_messages(client, mock_litellm):
    response = client.post(
        "/api/chat",
        json={"user_id": "u1", "session_id": "s1", "message": "hello"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["assistant_message"] == "This is a mocked tutor response."
    assert isinstance(data["message_id"], int)


def test_chat_persists_both_roles(client, db_session, mock_litellm):
    client.post("/api/chat", json={"user_id": "u1", "session_id": "s1", "message": "hi"})
    msgs = db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == "s1")
    ).scalars().all()
    roles = {m.role for m in msgs}
    assert roles == {"user", "assistant"}


def test_chat_429_on_cap(client, mock_litellm):
    for _ in range(settings.daily_cap):
        r = client.post("/api/chat", json={"user_id": "u1", "session_id": "s1", "message": "x"})
        assert r.status_code == 200
    r = client.post("/api/chat", json={"user_id": "u1", "session_id": "s1", "message": "x"})
    assert r.status_code == 429
    assert "reset_at" in r.json()["detail"]

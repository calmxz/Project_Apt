"""TDD: POST /sessions/{id}/check/complete fires the hidden follow-up."""

import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from agent.stream_events import StreamEvent
from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import ChatMessage, Session as SessionModel, User
from services import check_question_service


USER_ID = "u_done_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_done_1", user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _resolved_batch(db, sid):
    ctx = ToolContext(db=db, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    check_question_service.answer(db, sid, index=0, selected_index=0)


def _make_fake_run_streaming(db, session_id):
    """Fake run_streaming: persists one assistant message (owns persistence like the
    real tutor) and yields done event. Mirrors test_chat_stream_route.py pattern."""
    async def fake(messages, system_prompt, ctx):
        msg = ChatMessage(session_id=session_id, role="assistant",
                          content="Great job!")
        ctx.db.add(msg)
        ctx.db.commit()
        yield StreamEvent("assistant_delta", {"text": "Great job!"})
        yield StreamEvent("done", {"message_id": str(msg.id)})
    return fake


def test_complete_streams_reply_clears_batch_no_user_message(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    _resolved_batch(db_session, sid)

    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))

    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    body = r.text
    assert "event: done" in body
    assert check_question_service.get_pending_check(db_session, sid) is None
    rows = db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == sid)
    ).scalars().all()
    assert [m.role for m in rows] == ["assistant"]


def test_complete_409_when_not_done(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    ctx = ToolContext(db=db_session, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db_session, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 409


def test_complete_409_when_no_batch(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 409


def test_complete_foreign_session_404(client, db_session, monkeypatch):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, "nope"))
    r = client.post("/api/sessions/nope/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 404


def _resolved_batch_miss(db, sid):
    """Same as _resolved_batch but answers WRONG (selected_index=1, correct=0)."""
    ctx = ToolContext(db=db, session_id=sid, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=sid, gap="atp",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))
    check_question_service.answer(db, sid, index=0, selected_index=1)


def test_complete_sets_quiz_cooldown_on_miss(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    _resolved_batch_miss(db_session, sid)
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    cd = check_question_service.get_quiz_cooldown(db_session, sid)
    assert cd is not None
    assert cd["gap"] == "atp"
    assert cd["last_score"] == "0/1"


def test_complete_no_cooldown_on_all_correct(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    _resolved_batch(db_session, sid)  # answers correctly
    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))
    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200
    assert check_question_service.get_quiz_cooldown(db_session, sid) is None


def test_complete_writes_check_batch_to_message(client, db_session, seeded_session, monkeypatch):
    sid = seeded_session.id
    _resolved_batch(db_session, sid)
    m = ChatMessage(session_id=sid, role="assistant", content="")
    db_session.add(m)
    db_session.commit()
    db_session.refresh(m)
    check_question_service.attach_message_id(db_session, sid, m.id)

    monkeypatch.setattr("agent.tutor.run_streaming",
                        _make_fake_run_streaming(db_session, sid))

    r = client.post(f"/api/sessions/{sid}/check/complete", json={"user_id": USER_ID})
    assert r.status_code == 200

    db_session.refresh(m)
    assert m.check_batch_json is not None
    data = json.loads(m.check_batch_json)
    assert data["gap"] == "atp"
    assert data["items"][0]["correct"] is True
    assert check_question_service.get_pending_check(db_session, sid) is None

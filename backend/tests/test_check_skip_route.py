"""TDD: POST /sessions/{id}/check/skip over a batch."""

from datetime import datetime, timezone

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import Session as SessionModel, User
from services import check_question_service


USER_ID = "u_skip_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_skip_1", user_id=USER_ID, topic="bio",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _open_batch(db, session_id):
    ctx = ToolContext(db=db, session_id=session_id, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=session_id, gap="g",
        items=[{"question": "Q1?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."},
               {"question": "Q2?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}]))


def test_skip_advances(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/skip",
                    json={"index": 0, "user_id": USER_ID})
    assert r.status_code == 200
    body = r.json()
    assert body["current_index"] == 1
    assert body["done"] is False


def test_skip_out_of_order_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/skip",
                    json={"index": 1, "user_id": USER_ID})
    assert r.status_code == 409


def test_skip_no_batch_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    r = client.post(f"/api/sessions/{sid}/check/skip",
                    json={"index": 0, "user_id": USER_ID})
    assert r.status_code == 409


def test_skip_foreign_session_is_404(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = client.post("/api/sessions/nope/check/skip",
                    json={"index": 0, "user_id": USER_ID})
    assert r.status_code == 404

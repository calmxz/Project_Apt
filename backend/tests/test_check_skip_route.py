"""TDD: POST /sessions/{id}/check/skip clears pending check (Task 12)."""

from datetime import datetime, timezone

import pytest

from contracts import TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq


USER_ID = "u1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_skip_1",
        user_id=USER_ID,
        topic="algebra",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def test_skip_clears_pending_check(client, db_session, seeded_session):
    sid = seeded_session.id
    cq.set_pending_check(
        db_session, sid, gap="g", question="q?",
        asked_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    resp = client.post(f"/api/sessions/{sid}/check/skip", json={"user_id": USER_ID})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert cq.get_pending_check(db_session, sid) is None


def test_skip_idempotent_when_none(client, db_session, seeded_session):
    sid = seeded_session.id
    resp = client.post(f"/api/sessions/{sid}/check/skip", json={"user_id": USER_ID})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_skip_404_for_unknown_session(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    resp = client.post("/api/sessions/nonexistent/check/skip", json={"user_id": USER_ID})
    assert resp.status_code == 404


def test_skip_404_for_wrong_user(client, db_session, seeded_session):
    db_session.add(User(id="other"))
    db_session.commit()
    sid = seeded_session.id
    resp = client.post(f"/api/sessions/{sid}/check/skip", json={"user_id": "other"})
    assert resp.status_code == 404

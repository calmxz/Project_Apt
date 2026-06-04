"""TDD: POST /sessions/{id}/check/answer deterministic grade (Task 5)."""

from datetime import datetime, timezone

import pytest

from contracts import TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service, profile_service


USER_ID = "u_ans_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_ans_1",
        user_id=USER_ID,
        topic="biology",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _open_check(db, session_id):
    check_question_service.set_pending_check(
        db, session_id, gap="atp", question="What nets per glucose?",
        options=["2 ATP", "36 ATP", "0 ATP"], correct_index=0,
        explanation="Net 2 ATP per glucose.",
        asked_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_answer_correct_returns_verdict_and_masters(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_check(db_session, sid)
    r = client.post(
        f"/api/sessions/{sid}/check/answer",
        json={"selected_index": 0, "user_id": USER_ID},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True
    assert body["correct_index"] == 0
    assert body["explanation"] == "Net 2 ATP per glucose."
    assert check_question_service.get_pending_check(db_session, sid) is None
    assert "atp" in profile_service.load_profile(db_session, sid).mastered_concepts


def test_answer_incorrect_returns_false(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_check(db_session, sid)
    r = client.post(
        f"/api/sessions/{sid}/check/answer",
        json={"selected_index": 1, "user_id": USER_ID},
    )
    assert r.status_code == 200
    assert r.json()["correct"] is False


def test_answer_out_of_range_is_422(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_check(db_session, sid)
    r = client.post(
        f"/api/sessions/{sid}/check/answer",
        json={"selected_index": 9, "user_id": USER_ID},
    )
    assert r.status_code == 422


def test_answer_no_pending_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    r = client.post(
        f"/api/sessions/{sid}/check/answer",
        json={"selected_index": 0, "user_id": USER_ID},
    )
    assert r.status_code == 409


def test_answer_foreign_session_is_404(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = client.post(
        "/api/sessions/does-not-exist/check/answer",
        json={"selected_index": 0, "user_id": USER_ID},
    )
    assert r.status_code == 404

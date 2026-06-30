"""TDD: POST /sessions/{id}/check/answer over a batch."""

import json
from datetime import datetime, timezone

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile
from agent.types import ToolContext
from db.models import ChatMessage, Lesson, Session as SessionModel, Subject, User
from services import check_question_service, plan_revision_service, profile_service
from services.plan_revision_service import STRUGGLE_THRESHOLD


USER_ID = "u_ans_1"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    session = SessionModel(
        id="s_ans_1", user_id=USER_ID, topic="biology",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(session)
    db_session.commit()
    return session


def _open_batch(db, session_id):
    ctx = ToolContext(db=db, session_id=session_id, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=session_id, gap="atp",
        items=[
            {"question": "Q1?", "options": ["2 ATP", "36 ATP"],
             "correct_index": 0, "explanation": "Net 2 ATP."},
            {"question": "Q2?", "options": ["a", "b"],
             "correct_index": 1, "explanation": "b."},
        ]))


def test_answer_first_item_advances(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True
    assert body["current_index"] == 1
    assert body["has_next"] is True
    assert body["done"] is False
    assert check_question_service.get_pending_check(db_session, sid) is not None
    assert "atp" in profile_service.load_profile(db_session, sid).mastered_concepts


def test_answer_last_item_done(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    client.post(f"/api/sessions/{sid}/check/answer",
                json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 1, "selected_index": 1, "user_id": USER_ID})
    assert r.json()["done"] is True


def test_answer_out_of_order_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 1, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 409


def test_answer_no_batch_is_409(client, db_session, seeded_session):
    sid = seeded_session.id
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 409


def test_answer_foreign_session_is_404(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = client.post("/api/sessions/nope/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 404


def test_answer_writes_check_batch_to_message(client, db_session, seeded_session):
    sid = seeded_session.id
    _open_batch(db_session, sid)
    m = ChatMessage(session_id=sid, role="assistant", content="")
    db_session.add(m)
    db_session.commit()
    db_session.refresh(m)
    check_question_service.attach_message_id(db_session, sid, m.id)
    r = client.post(f"/api/sessions/{sid}/check/answer",
                    json={"index": 0, "selected_index": 0, "user_id": USER_ID})
    assert r.status_code == 200
    db_session.refresh(m)
    assert m.check_batch_json is not None
    data = json.loads(m.check_batch_json)
    assert data["items"][0]["status"] == "answered"
    assert data["items"][0]["selected_index"] == 0


# ---------------------------------------------------------------------------
# Struggle-signal (add_lesson_suggestion) tests
# ---------------------------------------------------------------------------

SUBJ_ID = "sub_ans_1"
SUBJ_SID = "s_subj_ans"
LESSON_ID = "l_ans_1"


@pytest.fixture
def subject_session(db_session):
    """A lesson-backed session linked to a Subject and a Lesson."""
    db_session.add(User(id=USER_ID))
    db_session.add(Subject(
        id=SUBJ_ID, user_id=USER_ID, title="Chemistry",
        per_session_minutes=30, timeline_days=14, duration_mode="deadline",
    ))
    session = SessionModel(
        id=SUBJ_SID, user_id=USER_ID, topic="Alkanes",
        topic_profile_json=TopicProfile().model_dump_json(),
        subject_id=SUBJ_ID,
    )
    db_session.add(session)
    db_session.add(Lesson(
        id=LESSON_ID, subject_id=SUBJ_ID, order_idx=0, title="Alkanes",
        goal="g", status="in_progress", session_id=SUBJ_SID,
    ))
    db_session.commit()
    return session


def _open_alkanes_batch(db, session_id):
    """Two-item batch on gap 'alkanes'; item 0 correct_index=0, item 1 correct_index=1."""
    ctx = ToolContext(db=db, session_id=session_id, user_id=USER_ID,
                      turn_started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    check_question_service.register(db, ctx, AskCheckQuestionsArgs(
        session_id=session_id, gap="alkanes",
        items=[
            {"question": "What is methane?", "options": ["CH4", "C2H6"],
             "correct_index": 0, "explanation": "Methane is CH4."},
            {"question": "What is ethane?", "options": ["CH4", "C2H6"],
             "correct_index": 1, "explanation": "Ethane is C2H6."},
        ]))


def test_suggestion_fires_at_struggle_threshold(client, db_session, subject_session):
    """Exactly STRUGGLE_THRESHOLD wrong answers on one gap triggers add_lesson_suggestion."""
    assert STRUGGLE_THRESHOLD == 2, "test assumes threshold=2; update if constant changes"
    sid = subject_session.id
    _open_alkanes_batch(db_session, sid)

    # First wrong answer (item 0, correct_index=0, select 1 -> wrong)
    r1 = client.post(f"/api/sessions/{sid}/check/answer",
                     json={"index": 0, "selected_index": 1, "user_id": USER_ID})
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["correct"] is False
    # Only 1 miss so far — no suggestion yet
    assert body1["add_lesson_suggestion"] is None

    # Second wrong answer (item 1, correct_index=1, select 0 -> wrong)
    r2 = client.post(f"/api/sessions/{sid}/check/answer",
                     json={"index": 1, "selected_index": 0, "user_id": USER_ID})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["correct"] is False
    # 2 misses == STRUGGLE_THRESHOLD -> suggestion fires
    suggestion = body2["add_lesson_suggestion"]
    assert suggestion is not None
    assert suggestion["subject_id"] == SUBJ_ID
    assert suggestion["gap"] == "alkanes"
    assert suggestion["lesson_id"] == LESSON_ID
    assert suggestion["suggested_title"] == "alkanes practice"


def test_suggestion_absent_for_quick_session(client, db_session, seeded_session):
    """Subject-less (quick) session never returns add_lesson_suggestion, even at threshold."""
    assert STRUGGLE_THRESHOLD == 2, "test assumes threshold=2; update if constant changes"
    sid = seeded_session.id
    # Use _open_alkanes_batch so gap matches (atp gap in default _open_batch would also work,
    # but alkanes mirrors the subject session test for symmetry)
    _open_alkanes_batch(db_session, sid)

    # Two wrong answers
    r1 = client.post(f"/api/sessions/{sid}/check/answer",
                     json={"index": 0, "selected_index": 1, "user_id": USER_ID})
    assert r1.status_code == 200
    assert r1.json()["add_lesson_suggestion"] is None

    r2 = client.post(f"/api/sessions/{sid}/check/answer",
                     json={"index": 1, "selected_index": 0, "user_id": USER_ID})
    assert r2.status_code == 200
    # No subject -> never suggests
    assert r2.json()["add_lesson_suggestion"] is None

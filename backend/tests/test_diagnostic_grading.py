"""TDD: score->level assignment on diagnostic batch completion."""

from datetime import datetime, timezone

import pytest

from agent.types import ToolContext
from contracts import AskCheckQuestionsArgs, TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service, profile_service
from services.diagnostic_service import level_for_score


# Default auth identity from conftest's _fake_current_user_id when no
# Authorization header (and no user_id in the request body) is sent.
USER_ID = "test-user"

_T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def db(db_session):
    return db_session


@pytest.mark.parametrize(
    "n,expected", [(0, "beginner"), (1, "beginner"), (2, "intermediate"), (3, "advanced")]
)
def test_level_for_score_3q(n, expected):
    assert level_for_score(n, 3) == expected


@pytest.fixture
def fresh_session_with_diagnostic_batch(db_session):
    """Session with knowledge_level None -> register() tags the batch
    'diagnostic'. Returns (session_id, correct_indices) so a test can answer
    every item correctly."""
    db_session.add(User(id=USER_ID))
    db_session.flush()
    row = SessionModel(
        id="s_diag_1",
        user_id=USER_ID,
        topic="biology",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(row)
    db_session.commit()

    ctx = ToolContext(
        db=db_session, session_id=row.id, user_id=USER_ID, turn_started_at=_T0
    )
    correct_indices = [0, 1, 0]
    check_question_service.register(
        db_session,
        ctx,
        AskCheckQuestionsArgs(
            session_id=row.id,
            gap="warmup",
            items=[
                {
                    "question": "Q1?",
                    "options": ["a", "b"],
                    "correct_index": correct_indices[0],
                    "explanation": "e1",
                },
                {
                    "question": "Q2?",
                    "options": ["a", "b"],
                    "correct_index": correct_indices[1],
                    "explanation": "e2",
                },
                {
                    "question": "Q3?",
                    "options": ["a", "b"],
                    "correct_index": correct_indices[2],
                    "explanation": "e3",
                },
            ],
        ),
    )
    return row.id, correct_indices


@pytest.fixture
def session_with_level_and_check_batch(db_session):
    """Session with knowledge_level already set -> register() tags the batch
    'check' (not diagnostic). Returns session_id."""
    db_session.add(User(id=USER_ID))
    db_session.flush()
    row = SessionModel(
        id="s_check_1",
        user_id=USER_ID,
        topic="biology",
        topic_profile_json=TopicProfile(knowledge_level="intermediate").model_dump_json(),
    )
    db_session.add(row)
    db_session.commit()

    ctx = ToolContext(
        db=db_session, session_id=row.id, user_id=USER_ID, turn_started_at=_T0
    )
    check_question_service.register(
        db_session,
        ctx,
        AskCheckQuestionsArgs(
            session_id=row.id,
            gap="atp",
            items=[
                {
                    "question": "Q1?",
                    "options": ["a", "b"],
                    "correct_index": 0,
                    "explanation": "e1",
                },
            ],
        ),
    )
    return row.id


def test_answer_check_sets_level_on_diagnostic_completion(
    client, db, fresh_session_with_diagnostic_batch
):
    sid, correct_indices = fresh_session_with_diagnostic_batch  # 3-item diagnostic batch, all correct
    for i, ci in enumerate(correct_indices):
        r = client.post(f"/api/sessions/{sid}/check/answer", json={"index": i, "selected_index": ci})
        assert r.status_code == 200
    assert profile_service.load_profile(db, sid).knowledge_level == "advanced"


def test_answer_check_normal_check_leaves_level(client, db, session_with_level_and_check_batch):
    sid = session_with_level_and_check_batch  # knowledge_level already "intermediate"
    client.post(f"/api/sessions/{sid}/check/answer", json={"index": 0, "selected_index": 0})
    assert profile_service.load_profile(db, sid).knowledge_level == "intermediate"

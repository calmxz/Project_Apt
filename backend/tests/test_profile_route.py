"""TDD: GET /api/profile/{session_id}."""

import pytest

from contracts import TopicProfile
from db.models import LearningEvent, Session as SessionModel, User


SESSION_ID = "sess_1"
USER_ID = "u1"


@pytest.fixture
def seed_session(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile(
                knowledge_level="beginner",
                confirmed_gaps=["joins"],
                mastered_concepts=["select"],
            ).model_dump_json(),
        )
    )
    db_session.commit()


def test_profile_route_404_when_missing(client):
    r = client.get("/api/profile/does_not_exist")
    assert r.status_code == 404


def test_profile_route_empty_defaults(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(SessionModel(id=SESSION_ID, user_id=USER_ID, topic="sql"))
    db_session.commit()
    r = client.get(f"/api/profile/{SESSION_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["profile"]["knowledge_level"] is None
    assert body["profile"]["confirmed_gaps"] == []
    assert body["recent_learning_events"] == []


def test_profile_route_with_events_desc(client, db_session, seed_session):
    for i, correct in enumerate([True, False, True]):
        db_session.add(
            LearningEvent(
                session_id=SESSION_ID,
                gap_tested=f"gap_{i}",
                question=f"q_{i}",
                correct=correct,
            )
        )
    db_session.commit()
    r = client.get(f"/api/profile/{SESSION_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["profile"]["knowledge_level"] == "beginner"
    assert body["profile"]["confirmed_gaps"] == ["joins"]
    assert len(body["recent_learning_events"]) == 3
    # ordered desc by created_at -> latest first
    assert body["recent_learning_events"][0]["gap_tested"] == "gap_2"

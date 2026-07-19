"""F-34: duplicate-topic detection is server-side, case-insensitive, and
covers create + reopen."""
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from contracts import TopicProfile
from db.models import Session as SessionModel, User


def _create(client, topic, uid="dupe-user"):
    return client.post(
        "/api/sessions",
        json={"topic": topic, "seed_mode": "fresh"},
        headers={"Authorization": f"Bearer test-{uid}"},
    )


def test_create_conflicts_with_active_same_topic(client):
    first = _create(client, "Chain Rule")
    assert first.status_code == 201
    dup = _create(client, "chain rule")  # case-insensitive
    assert dup.status_code == 409
    detail = dup.json()["detail"]
    assert detail["code"] == "duplicate_topic"
    assert detail["session_id"] == first.json()["id"]


def test_create_allowed_after_end(client):
    first = _create(client, "Osmosis")
    sid = first.json()["id"]
    ended = client.post(
        f"/api/sessions/{sid}/end",
        headers={"Authorization": "Bearer test-dupe-user"},
    )
    assert ended.status_code == 200
    again = _create(client, "Osmosis")
    assert again.status_code == 201


def test_reopen_conflicts_with_active_same_topic(client):
    first = _create(client, "Mitosis")
    sid = first.json()["id"]
    client.post(f"/api/sessions/{sid}/end",
                headers={"Authorization": "Bearer test-dupe-user"})
    second = _create(client, "Mitosis")
    assert second.status_code == 201
    reopened = client.post(
        f"/api/sessions/{sid}/reopen",
        headers={"Authorization": "Bearer test-dupe-user"},
    )
    assert reopened.status_code == 409
    assert reopened.json()["detail"]["code"] == "duplicate_topic"


def test_other_users_topic_does_not_conflict(client):
    _create(client, "Redox", uid="alice")
    other = _create(client, "Redox", uid="bob")
    assert other.status_code == 201


def test_db_rejects_second_active_session_same_topic_casefold(db_session):
    db_session.add(User(id="u_ix"))
    db_session.flush()
    db_session.add(SessionModel(
        id="s_ix1", user_id="u_ix", topic="Calculus",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()
    db_session.add(SessionModel(
        id="s_ix2", user_id="u_ix", topic="calculus",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_db_allows_duplicate_topic_when_first_is_ended(db_session):
    db_session.add(User(id="u_ix2"))
    db_session.flush()
    db_session.add(SessionModel(
        id="s_ix3", user_id="u_ix2", topic="Algebra",
        topic_profile_json=TopicProfile().model_dump_json(),
        ended_at=datetime.now(timezone.utc),
    ))
    db_session.commit()
    db_session.add(SessionModel(
        id="s_ix4", user_id="u_ix2", topic="Algebra",
        topic_profile_json=TopicProfile().model_dump_json(),
    ))
    db_session.commit()  # must not raise

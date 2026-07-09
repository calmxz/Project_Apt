from datetime import datetime, timedelta, timezone

from db.models import LearningEvent, Session as SessionModel, User

T0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)


def _seed_session(db, session_id="s1", user_id="test-user", topic="biology"):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
    db.add(SessionModel(id=session_id, user_id=user_id, topic=topic))
    db.commit()


def _seed_event(db, session_id, gap, correct, created_at):
    db.add(
        LearningEvent(
            session_id=session_id,
            gap_tested=gap,
            question="q",
            correct=correct,
            created_at=created_at,
        )
    )
    db.commit()


def test_empty_queue(client, db_session):
    r = client.get("/api/review/queue")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["limit"] == 20
    assert body["offset"] == 0


def test_due_concept_appears_with_fields(client, db_session):
    _seed_session(db_session)
    # incorrect answer 3 days ago -> streak 0 -> due 1 day later -> overdue now
    _seed_event(db_session, "s1", "mitosis", False, T0)
    r = client.get("/api/review/queue")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["concept"] == "mitosis"
    assert item["source_session_id"] == "s1"
    assert item["source_topic"] == "biology"
    assert item["streak"] == 0
    assert item["last_tested_at"].startswith("2026-07-01")
    assert item["due_at"].startswith("2026-07-02")


def test_not_yet_due_concept_excluded(client, db_session):
    _seed_session(db_session)
    # correct answer just now -> streak 1 -> due in 1 day -> not due yet
    _seed_event(
        db_session, "s1", "osmosis", True, datetime.now(timezone.utc)
    )
    r = client.get("/api/review/queue")
    assert r.json()["total"] == 0


def test_cross_session_aggregation_and_pagination(client, db_session):
    _seed_session(db_session, session_id="s1", topic="biology")
    _seed_session(db_session, session_id="s2", topic="chemistry")
    _seed_event(db_session, "s1", "older", False, T0)
    _seed_event(db_session, "s2", "newer", False, T0 + timedelta(days=1))
    r = client.get("/api/review/queue", params={"limit": 1, "offset": 0})
    body = r.json()
    assert body["total"] == 2
    assert len(body["items"]) == 1
    assert body["items"][0]["concept"] == "older"  # most overdue first
    r2 = client.get("/api/review/queue", params={"limit": 1, "offset": 1})
    assert r2.json()["items"][0]["concept"] == "newer"


def test_user_isolation(client, db_session):
    _seed_session(db_session, session_id="s1", user_id="other-user")
    _seed_event(db_session, "s1", "mitosis", False, T0)
    # default client auth resolves to "test-user"; other-user's events invisible
    r = client.get("/api/review/queue")
    assert r.json()["total"] == 0


def test_queue_rejects_invalid_token(client, db_session):
    # conftest fake auth: a bearer token not prefixed "test-" raises 401
    r = client.get(
        "/api/review/queue", headers={"Authorization": "Bearer bogus"}
    )
    assert r.status_code == 401


def test_queue_makes_no_llm_call(client, db_session, monkeypatch):
    import litellm

    def _boom(*args, **kwargs):
        raise AssertionError("queue path must not call the LLM")

    monkeypatch.setattr(litellm, "acompletion", _boom, raising=False)
    monkeypatch.setattr(litellm, "completion", _boom, raising=False)
    _seed_session(db_session)
    _seed_event(db_session, "s1", "mitosis", False, T0)
    r = client.get("/api/review/queue")
    assert r.status_code == 200
    assert r.json()["total"] == 1

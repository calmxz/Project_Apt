"""GET /api/profile/aggregate — cross-session aggregate dashboard."""

from datetime import datetime, timedelta, timezone

from contracts import TopicProfile
from db.models import LearningEvent, Session as SessionModel, User


USER_ID = "u_agg"


def _mk_session(
    db,
    sid: str,
    *,
    user_id: str = USER_ID,
    topic: str = "",
    profile: TopicProfile | None = None,
    created_at: datetime | None = None,
    ended_at: datetime | None = None,
) -> SessionModel:
    s = SessionModel(
        id=sid,
        user_id=user_id,
        topic=topic,
        topic_profile_json=(profile or TopicProfile()).model_dump_json(),
    )
    if created_at is not None:
        s.created_at = created_at
    if ended_at is not None:
        s.ended_at = ended_at
    db.add(s)
    return s


def test_aggregate_empty_user_returns_zeros(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()
    r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200
    body = r.json()
    assert body["total_sessions"] == 0
    assert body["active_sessions"] == 0
    assert body["ended_sessions"] == 0
    assert body["total_learning_events"] == 0
    assert body["last_active_at"] is None
    assert body["combined_mastered_concepts"] == []
    assert body["combined_confirmed_gaps"] == []
    assert body["knowledge_level_distribution"] == {
        "beginner": 0,
        "intermediate": 0,
        "advanced": 0,
        "unknown": 0,
    }
    assert body["recent_topics"] == []


def test_aggregate_overlapping_concepts_dedupe_and_count(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    t0 = datetime(2026, 5, 1, tzinfo=timezone.utc)
    _mk_session(
        db_session,
        "s1",
        topic="sql",
        created_at=t0,
        profile=TopicProfile(
            knowledge_level="beginner",
            mastered_concepts=["joins", "select"],
            confirmed_gaps=["window-fns"],
        ),
    )
    _mk_session(
        db_session,
        "s2",
        topic="sql-2",
        created_at=t0 + timedelta(days=1),
        profile=TopicProfile(
            knowledge_level="intermediate",
            mastered_concepts=["joins", "indexes"],
            confirmed_gaps=["window-fns", "ctes"],
        ),
    )
    _mk_session(
        db_session,
        "s3",
        topic="sql-3",
        created_at=t0 + timedelta(days=2),
        profile=TopicProfile(
            knowledge_level="intermediate",
            mastered_concepts=["joins"],
            confirmed_gaps=["window-fns"],
        ),
    )
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200
    body = r.json()

    assert body["total_sessions"] == 3
    assert body["active_sessions"] == 3
    assert body["ended_sessions"] == 0

    mastered = {c["concept"]: c for c in body["combined_mastered_concepts"]}
    assert mastered["joins"]["count"] == 3
    assert mastered["joins"]["first_seen_session_id"] == "s1"
    assert mastered["select"]["count"] == 1
    assert mastered["indexes"]["count"] == 1
    assert mastered["indexes"]["first_seen_session_id"] == "s2"
    # sorted by count desc
    assert body["combined_mastered_concepts"][0]["concept"] == "joins"

    gaps = {g["concept"]: g for g in body["combined_confirmed_gaps"]}
    assert gaps["window-fns"]["count"] == 3
    assert gaps["window-fns"]["first_seen_session_id"] == "s1"
    assert gaps["ctes"]["count"] == 1
    assert body["combined_confirmed_gaps"][0]["concept"] == "window-fns"


def test_aggregate_knowledge_level_distribution(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    _mk_session(db_session, "k1", profile=TopicProfile(knowledge_level="beginner"))
    _mk_session(db_session, "k2", profile=TopicProfile(knowledge_level="beginner"))
    _mk_session(db_session, "k3", profile=TopicProfile(knowledge_level="advanced"))
    _mk_session(db_session, "k4", profile=TopicProfile())  # unknown
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200
    dist = r.json()["knowledge_level_distribution"]
    assert dist == {
        "beginner": 2,
        "intermediate": 0,
        "advanced": 1,
        "unknown": 1,
    }


def test_aggregate_event_count_and_recent_topics(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    base = datetime(2026, 5, 1, tzinfo=timezone.utc)
    for i in range(7):
        _mk_session(
            db_session,
            f"r{i}",
            topic=f"topic-{i}",
            created_at=base + timedelta(days=i),
            ended_at=(base + timedelta(days=i, hours=1)) if i % 2 == 0 else None,
        )
    db_session.flush()
    for i in range(4):
        db_session.add(
            LearningEvent(
                session_id="r0",
                gap_tested=f"g{i}",
                question="?",
                correct=bool(i % 2),
            )
        )
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    body = r.json()
    assert r.status_code == 200
    assert body["total_sessions"] == 7
    assert body["ended_sessions"] == 4  # i=0,2,4,6
    assert body["active_sessions"] == 3
    assert body["total_learning_events"] == 4
    topics = [t["topic"] for t in body["recent_topics"]]
    assert topics == ["topic-6", "topic-5", "topic-4", "topic-3", "topic-2"]
    assert body["last_active_at"] is not None


def test_aggregate_isolates_per_user(client, db_session):
    db_session.add(User(id="u_alpha"))
    db_session.add(User(id="u_beta"))
    db_session.flush()
    _mk_session(
        db_session,
        "a1",
        user_id="u_alpha",
        profile=TopicProfile(mastered_concepts=["alpha-only"]),
    )
    _mk_session(
        db_session,
        "b1",
        user_id="u_beta",
        profile=TopicProfile(mastered_concepts=["beta-only"]),
    )
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": "u_alpha"})
    body = r.json()
    assert body["total_sessions"] == 1
    assert [c["concept"] for c in body["combined_mastered_concepts"]] == ["alpha-only"]

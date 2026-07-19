"""GET /api/profile/aggregate — cross-session aggregate dashboard."""

import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from sqlalchemy import event as _sa_event

from contracts import TopicProfile
from db.models import ChatMessage, LearningEvent, Session as SessionModel, User


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
            mastered_concepts=[{"name": "joins"}, {"name": "select"}],
            confirmed_gaps=[{"name": "window-fns"}],
        ),
    )
    _mk_session(
        db_session,
        "s2",
        topic="sql-2",
        created_at=t0 + timedelta(days=1),
        profile=TopicProfile(
            knowledge_level="intermediate",
            mastered_concepts=[{"name": "joins"}, {"name": "indexes"}],
            confirmed_gaps=[{"name": "window-fns"}, {"name": "ctes"}],
        ),
    )
    _mk_session(
        db_session,
        "s3",
        topic="sql-3",
        created_at=t0 + timedelta(days=2),
        profile=TopicProfile(
            knowledge_level="intermediate",
            mastered_concepts=[{"name": "joins"}],
            confirmed_gaps=[{"name": "window-fns"}],
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
    # Distinct topics: uq_sessions_active_topic forbids two simultaneously-active
    # same-topic sessions per user, and topic content is irrelevant to this test.
    _mk_session(db_session, "k1", topic="k1-topic", profile=TopicProfile(knowledge_level="beginner"))
    _mk_session(db_session, "k2", topic="k2-topic", profile=TopicProfile(knowledge_level="beginner"))
    _mk_session(db_session, "k3", topic="k3-topic", profile=TopicProfile(knowledge_level="advanced"))
    _mk_session(db_session, "k4", topic="k4-topic", profile=TopicProfile())  # unknown
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
        profile=TopicProfile(mastered_concepts=[{"name": "alpha-only"}]),
    )
    _mk_session(
        db_session,
        "b1",
        user_id="u_beta",
        profile=TopicProfile(mastered_concepts=[{"name": "beta-only"}]),
    )
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": "u_alpha"})
    body = r.json()
    assert body["total_sessions"] == 1
    assert [c["concept"] for c in body["combined_mastered_concepts"]] == ["alpha-only"]


def test_aggregate_recent_topics_carry_last_session_summary(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    ended_profile = TopicProfile(last_session_summary="Covered Big-O; gap in log bounds.")
    _mk_session(
        db_session,
        "ended1",
        topic="Big-O",
        profile=ended_profile,
        created_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        ended_at=datetime(2026, 5, 2, tzinfo=timezone.utc),
    )
    _mk_session(
        db_session,
        "active1",
        topic="Trees",
        profile=TopicProfile(),
        created_at=datetime(2026, 5, 3, tzinfo=timezone.utc),
    )
    db_session.commit()

    body = client.get("/api/profile/aggregate", params={"user_id": USER_ID}).json()
    by_id = {t["id"]: t for t in body["recent_topics"]}
    assert by_id["ended1"]["last_session_summary"] == "Covered Big-O; gap in log bounds."
    assert by_id["active1"]["last_session_summary"] is None


# Mirrors backend/tests/test_sessions_perf.py::count_queries (kept local to avoid
# cross-test-module import; dedupe into a shared helper is a future option).
@contextmanager
def _count_queries(db):
    bind = db.get_bind()
    state = {"n": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        state["n"] += 1

    _sa_event.listen(bind, "before_cursor_execute", _before)
    try:
        yield state
    finally:
        _sa_event.remove(bind, "before_cursor_execute", _before)


def test_recent_topics_carry_enriched_fields(client, db_session):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    prof = {"focus_target_gap": "ATP yield",
            "mastered_concepts": ["a", "b", "c"], "confirmed_gaps": []}
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(SessionModel(id="s_rich", user_id=USER_ID, topic="Glycolysis",
                                created_at=base, topic_profile_json=json.dumps(prof)))
    db_session.add(ChatMessage(session_id="s_rich", role="user", content="hi",
                               created_at=base))
    db_session.add(ChatMessage(session_id="s_rich", role="assistant",
                               content="glycolysis nets 2 ATP per glucose",
                               created_at=base + timedelta(minutes=1)))
    db_session.commit()

    r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200, r.text
    rt = next(t for t in r.json()["recent_topics"] if t["id"] == "s_rich")
    assert rt["message_count"] == 2
    assert rt["last_message_preview"] == "glycolysis nets 2 ATP per glucose"
    assert rt["last_activity_at"] is not None
    assert rt["progress"]["focus_target_gap"] == "ATP yield"
    assert rt["progress"]["mastered_count"] == 3


def test_recent_topics_enrichment_is_set_based(client, db_session):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    db_session.add(User(id=USER_ID))
    db_session.flush()
    for n in range(8):  # more than the 5-row recent window
        sid = f"s{n}"
        db_session.add(SessionModel(id=sid, user_id=USER_ID, topic=f"t{n}",
                                    created_at=base, topic_profile_json="{}"))
        db_session.add(ChatMessage(session_id=sid, role="user", content="x",
                                   created_at=base))
    db_session.commit()

    with _count_queries(db_session) as q:
        r = client.get("/api/profile/aggregate", params={"user_id": USER_ID})
    assert r.status_code == 200, r.text
    # Set-based path is ~4-5 total queries (baseline ~2 + compute_enrichment's 2);
    # a per-session preview over the 5-row recent window would clear this. Keep the
    # bound tight so the assertion actually proves "set-based", not just "not insane".
    assert q["n"] <= 6, f"aggregate enrichment not set-based: {q['n']} queries"


T0 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)


def _seed_session_for_insights(db, session_id="s1", user_id="test-user", topic="biology"):
    if not db.get(User, user_id):
        db.add(User(id=user_id))
    db.add(SessionModel(id=session_id, user_id=user_id, topic=topic))
    db.commit()


def _seed_event_for_insights(db, session_id, gap, correct, created_at, purpose=None):
    db.add(
        LearningEvent(
            session_id=session_id,
            gap_tested=gap,
            question="q",
            correct=correct,
            created_at=created_at,
            purpose=purpose,
        )
    )
    db.commit()


def test_concept_accuracy_math_and_first_session(client, db_session):
    # s2 needs a distinct topic from s1's default "biology": both are active
    # (no ended_at) for the same user, and uq_sessions_active_topic forbids two
    # simultaneously-active same-topic sessions per user. Topic content is not
    # asserted here.
    _seed_session_for_insights(db_session, session_id="s1")
    _seed_session_for_insights(db_session, session_id="s2", topic="biology-2")
    _seed_event_for_insights(db_session, "s1", "mitosis", False, T0)
    _seed_event_for_insights(db_session, "s2", "mitosis", True, T0 + timedelta(hours=1))
    _seed_event_for_insights(db_session, "s2", "mitosis", True, T0 + timedelta(hours=2))
    body = client.get("/api/profile/aggregate").json()
    assert len(body["concept_accuracy"]) == 1
    entry = body["concept_accuracy"][0]
    assert entry["concept"] == "mitosis"
    assert entry["correct_count"] == 2
    assert entry["total_count"] == 3
    assert abs(entry["accuracy"] - 2 / 3) < 0.001
    assert entry["first_seen_session_id"] == "s1"  # earliest event, not most events


def test_concept_accuracy_excludes_diagnostic_keeps_null_purpose(client, db_session):
    _seed_session_for_insights(db_session)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0, purpose="diagnostic")
    _seed_event_for_insights(db_session, "s1", "osmosis", True, T0, purpose=None)
    _seed_event_for_insights(db_session, "s1", "diffusion", True, T0, purpose="check")
    body = client.get("/api/profile/aggregate").json()
    concepts = {e["concept"] for e in body["concept_accuracy"]}
    assert concepts == {"osmosis", "diffusion"}


def test_last_results_capped_at_five_oldest_to_newest(client, db_session):
    _seed_session_for_insights(db_session)
    # 7 events: F F F T T T F -> last 5 = F T T T F
    pattern = [False, False, False, True, True, True, False]
    for i, ok in enumerate(pattern):
        _seed_event_for_insights(
            db_session, "s1", "mitosis", ok, T0 + timedelta(minutes=i)
        )
    body = client.get("/api/profile/aggregate").json()
    entry = body["concept_accuracy"][0]
    assert entry["last_results"] == [False, True, True, True, False]
    assert entry["total_count"] == 7


def test_concept_accuracy_empty_when_no_events(client, db_session):
    _seed_session_for_insights(db_session)
    body = client.get("/api/profile/aggregate").json()
    assert body["concept_accuracy"] == []
    assert len(body["weekly_mastery"]) == 12


def test_weekly_mastery_buckets_first_correct_only(db_session):
    from services.profile_service import aggregate_for_user

    _seed_session_for_insights(db_session)
    # mitosis: wrong then correct in week of 2026-06-29, correct again 2 weeks later
    _seed_event_for_insights(db_session, "s1", "mitosis", False, T0)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0 + timedelta(hours=1))
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0 + timedelta(weeks=2))
    # osmosis: first correct 1 week after T0
    _seed_event_for_insights(db_session, "s1", "osmosis", True, T0 + timedelta(weeks=1))
    # diffusion: never correct -> never counted
    _seed_event_for_insights(db_session, "s1", "diffusion", False, T0)

    now = T0 + timedelta(weeks=2)  # 2026-07-15
    resp = aggregate_for_user(db_session, "test-user", now=now)

    assert len(resp.weekly_mastery) == 12
    # oldest first, consecutive Mondays, newest bucket = Monday of `now`
    assert resp.weekly_mastery[-1].week_start.isoformat() == "2026-07-13"
    assert resp.weekly_mastery[0].week_start.isoformat() == "2026-04-27"
    by_week = {p.week_start.isoformat(): p.count for p in resp.weekly_mastery}
    assert by_week["2026-06-29"] == 1  # mitosis first correct
    assert by_week["2026-07-06"] == 1  # osmosis
    assert by_week["2026-07-13"] == 0  # mitosis retest does NOT recount
    assert sum(p.count for p in resp.weekly_mastery) == 2


def test_weekly_mastery_outside_window_dropped(db_session):
    from services.profile_service import aggregate_for_user

    _seed_session_for_insights(db_session)
    # first correct 20 weeks before `now` -> outside the 12-week window
    _seed_event_for_insights(db_session, "s1", "ancient", True, T0)
    now = T0 + timedelta(weeks=20)
    resp = aggregate_for_user(db_session, "test-user", now=now)
    assert sum(p.count for p in resp.weekly_mastery) == 0
    assert len(resp.weekly_mastery) == 12


def test_weekly_mastery_diagnostic_correct_not_counted(db_session):
    from services.profile_service import aggregate_for_user

    _seed_session_for_insights(db_session)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0, purpose="diagnostic")
    resp = aggregate_for_user(db_session, "test-user", now=T0)
    assert sum(p.count for p in resp.weekly_mastery) == 0


def test_aggregate_makes_no_llm_call(client, db_session, monkeypatch):
    import litellm

    def _boom(*args, **kwargs):
        raise AssertionError("aggregate path must not call the LLM")

    monkeypatch.setattr(litellm, "acompletion", _boom, raising=False)
    monkeypatch.setattr(litellm, "completion", _boom, raising=False)
    _seed_session_for_insights(db_session)
    _seed_event_for_insights(db_session, "s1", "mitosis", True, T0)
    assert client.get("/api/profile/aggregate").status_code == 200

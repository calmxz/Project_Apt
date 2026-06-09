import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event as _sa_event

from contracts import TopicProfile  # noqa: F401  (ensures schema exists)
from db.database import Base
from db.models import ChatMessage, LearningEvent, Session as SessionModel, User  # noqa: F401  (registers models on Base.metadata)


@contextmanager
def count_queries(db):
    """Count SQL statements executed on db's bind within the block.

    Portable across SQLite/Postgres via the before_cursor_execute event.
    Usage:
        with count_queries(db_session) as q:
            client.get(...)
        assert q["n"] <= 8
    """
    bind = db.get_bind()
    state = {"n": 0}

    def _before(conn, cursor, statement, params, context, executemany):
        state["n"] += 1

    _sa_event.listen(bind, "before_cursor_execute", _before)
    try:
        yield state
    finally:
        _sa_event.remove(bind, "before_cursor_execute", _before)


def test_perf_indexes_declared_on_models():
    cm = Base.metadata.tables["chat_messages"]
    le = Base.metadata.tables["learning_events"]
    cm_index_cols = {tuple(c.name for c in ix.columns) for ix in cm.indexes}
    le_index_cols = {tuple(c.name for c in ix.columns) for ix in le.indexes}
    assert ("session_id", "created_at") in cm_index_cols
    assert ("session_id",) in le_index_cols


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def _seed_asking_session(db, sid, n_asking, items_per=3):
    """Session with n_asking messages that each ask `items_per` check questions
    via an ask_check_questions tool call but have NO persisted check_batch_json
    (the legacy/reconstruct path). Each item has a matching LearningEvent."""
    db.add(SessionModel(id=sid, user_id=USER_ID, topic="bio",
                        topic_profile_json=TopicProfile().model_dump_json()))
    for a in range(n_asking):
        gap = f"gap-{sid}-{a}"
        items = [{"question": f"q{a}-{i}", "options": ["x", "y"],
                  "correct_index": 0, "explanation": "because"} for i in range(items_per)]
        tool_calls = [{"name": "ask_check_questions", "args": {"gap": gap, "items": items},
                       "status": "ok", "error": None}]
        db.add(ChatMessage(session_id=sid, role="assistant", content=f"asking {a}",
                           tool_calls_json=json.dumps(tool_calls)))
        for i in range(items_per):
            db.add(LearningEvent(session_id=sid, gap_tested=gap,
                                question=f"q{a}-{i}", correct=True))
    db.commit()


def test_list_sessions_enriched_fields(client, db_session, seeded_user):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    prof = {"focus_target_gap": "ATP yield", "mastered_concepts": ["a", "b", "c"],
            "confirmed_gaps": [], "knowledge_level": None, "last_session_summary": None}
    db_session.add(SessionModel(id="s_rich", user_id=USER_ID, topic="Glycolysis",
                               topic_profile_json=json.dumps(prof)))
    db_session.add(ChatMessage(session_id="s_rich", role="user", content="hi",
                              created_at=base))
    db_session.add(ChatMessage(session_id="s_rich", role="assistant",
                              content="glycolysis nets 2 ATP per glucose",
                              created_at=base + timedelta(minutes=1)))
    # trailing empty assistant turn (cancelled stream) must be skipped by preview
    db_session.add(ChatMessage(session_id="s_rich", role="assistant", content="   ",
                              created_at=base + timedelta(minutes=2)))
    db_session.commit()

    r = client.get(f"/api/sessions?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    item = next(s for s in r.json() if s["id"] == "s_rich")
    assert item["message_count"] == 3
    assert item["last_message_preview"] == "glycolysis nets 2 ATP per glucose"
    assert item["progress"]["focus_target_gap"] == "ATP yield"
    assert item["progress"]["mastered_count"] == 3
    assert item["last_activity_at"] is not None


def test_list_sessions_query_count_constant(client, db_session, seeded_user):
    for n in range(1, 6):
        sid = f"s_count_{n}"
        db_session.add(SessionModel(id=sid, user_id=USER_ID, topic=f"t{n}",
                                   topic_profile_json="{}"))
        db_session.add(ChatMessage(session_id=sid, role="user", content="x"))
    db_session.commit()
    with count_queries(db_session) as q:
        r = client.get(f"/api/sessions?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    # Enrichment must be set-based: a small constant, not one query per session.
    assert q["n"] <= 6, f"list endpoint not set-based: {q['n']} queries"


def test_get_session_detail_is_not_n_plus_one(client, db_session, seeded_user):
    _seed_asking_session(db_session, "s_one", n_asking=1)
    _seed_asking_session(db_session, "s_three", n_asking=3)

    with count_queries(db_session) as q1:
        r1 = client.get(f"/api/sessions/s_one?user_id={USER_ID}")
    with count_queries(db_session) as q3:
        r3 = client.get(f"/api/sessions/s_three?user_id={USER_ID}")

    assert r1.status_code == 200, r1.text
    assert r3.status_code == 200, r3.text
    # Query count must NOT grow with the number of asking messages / items.
    assert q3["n"] == q1["n"], f"N+1: 1-asking={q1['n']} vs 3-asking={q3['n']}"


def test_list_sessions_preview_skips_non_space_whitespace(client, db_session, seeded_user):
    base = datetime(2026, 6, 3, tzinfo=timezone.utc)
    db_session.add(SessionModel(id="s_ws", user_id=USER_ID, topic="WS",
                               topic_profile_json="{}"))
    db_session.add(ChatMessage(session_id="s_ws", role="assistant",
                              content="real answer here", created_at=base))
    # aborted stream persisted a tab/newline-only trailing turn
    db_session.add(ChatMessage(session_id="s_ws", role="assistant",
                              content="\t\n  ", created_at=base + timedelta(minutes=1)))
    db_session.commit()
    r = client.get(f"/api/sessions?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    item = next(s for s in r.json() if s["id"] == "s_ws")
    assert item["last_message_preview"] == "real answer here"


def _seed_simple(db, sid, topic, ended=False, activity=None):
    db.add(SessionModel(id=sid, user_id=USER_ID, topic=topic, topic_profile_json="{}",
                        ended_at=(datetime(2026, 6, 2, tzinfo=timezone.utc) if ended else None)))
    if activity is not None:
        db.add(ChatMessage(session_id=sid, role="user", content="x", created_at=activity))
    db.commit()


def test_library_filters_by_status(client, db_session, seeded_user):
    _seed_simple(db_session, "lib_a", "Active one", ended=False)
    _seed_simple(db_session, "lib_b", "Ended one", ended=True)
    r = client.get(f"/api/sessions/library?status=ended&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert {i["id"] for i in body["items"]} == {"lib_b"}
    assert body["total"] == 1


def test_library_search_and_pagination(client, db_session, seeded_user):
    for n in range(5):
        _seed_simple(db_session, f"lib_{n}", f"Glyco {n}")
    _seed_simple(db_session, "lib_other", "Mitosis")
    r = client.get(f"/api/sessions/library?q=glyco&limit=2&offset=0&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert all("Glyco" in i["topic"] for i in body["items"])


def test_library_sort_last_activity(client, db_session, seeded_user):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    _seed_simple(db_session, "lib_old_created_recent_active", "A",
                 activity=base + timedelta(days=10))
    _seed_simple(db_session, "lib_new_created_no_activity", "B")
    r = client.get(f"/api/sessions/library?sort=last_activity&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    # The session touched most recently sorts first.
    assert ids[0] == "lib_old_created_recent_active"


def test_library_route_not_shadowed_by_session_id(client, db_session, seeded_user):
    # Guards the route-ordering gotcha: /sessions/library must not be captured
    # by /sessions/{session_id}.
    r = client.get(f"/api/sessions/library?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    assert "items" in r.json()


@pytest.mark.parametrize("qs", ["limit=0", "limit=101", "offset=-1", "status=garbage", "sort=garbage"])
def test_library_rejects_invalid_params(client, db_session, seeded_user, qs):
    r = client.get(f"/api/sessions/library?{qs}&user_id={USER_ID}")
    assert r.status_code == 422, f"expected 422 for {qs}, got {r.status_code}: {r.text}"


def test_library_sort_topic_is_stable_by_id(client, db_session, seeded_user):
    # All same topic so ONLY the id tiebreaker determines order. Insert in an
    # order that differs from id-sorted order to prove the tiebreaker is applied.
    for sid in ["s_z", "s_a", "s_m"]:
        _seed_simple(db_session, sid, "SameTopic")
    r = client.get(f"/api/sessions/library?sort=topic&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    assert ids == ["s_a", "s_m", "s_z"], ids

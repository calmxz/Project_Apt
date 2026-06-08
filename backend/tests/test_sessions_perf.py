import json
from contextlib import contextmanager

import pytest
from sqlalchemy import event as _sa_event
from sqlalchemy import inspect

from contracts import TopicProfile
from db.database import Base
from db.models import ChatMessage, LearningEvent, Session as SessionModel, User
import db.models  # noqa: F401  (register models on Base.metadata)


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

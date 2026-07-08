"""P3.1 statement-count budget for the chat prepare path.

Counts SQL statements issued by _prepare_turn via before_cursor_execute.
Budget (spec P3.1): <=6 happy path, <=7 when the gap-accuracy aggregate
runs (non-empty confirmed_gaps). Uses an existing user: the first-turn-ever
user-create path is excluded from the budget by design.
"""

import asyncio
from contextlib import contextmanager
from uuid import uuid4

import pytest
from sqlalchemy import event as _sa_event

from contracts import ChatRequest, TopicProfile
from db.models import LearningEvent, Session as SessionModel, User
from routes.chat import _prepare_turn


@contextmanager
def count_queries(db):
    bind = db.get_bind()
    state = {"n": 0, "statements": []}

    def _before(conn, cursor, statement, params, context, executemany):
        state["n"] += 1
        state["statements"].append(statement.split("\n")[0][:120])

    _sa_event.listen(bind, "before_cursor_execute", _before)
    try:
        yield state
    finally:
        _sa_event.remove(bind, "before_cursor_execute", _before)


USER_ID = "perf-user"


@pytest.fixture
def seeded_session(db_session):
    db_session.add(User(id=USER_ID))
    sess = SessionModel(id=str(uuid4()), user_id=USER_ID, topic="algebra")
    db_session.add(sess)
    db_session.commit()
    return sess


def _run_prepare(db, session_id):
    req = ChatRequest(session_id=session_id, message="explain factoring")
    return asyncio.run(_prepare_turn(req, USER_ID, db))


def test_prepare_turn_budget_no_gaps(db_session, seeded_session):
    # Evaluate .id BEFORE the counted block: the fixture's commit expires the
    # ORM instance (expire_on_commit=True), so accessing .id inside the block
    # would trigger an extra refresh SELECT that is test-setup overhead, not
    # part of _prepare_turn's own work. Mirrors test_sessions_perf.py's
    # pattern of using plain-string ids inside count_queries.
    session_id = seeded_session.id
    with count_queries(db_session) as q:
        _run_prepare(db_session, session_id)
    assert q["n"] <= 6, f"prepare path used {q['n']} statements:\n" + "\n".join(q["statements"])


def test_prepare_turn_budget_with_gaps(db_session, seeded_session):
    profile = TopicProfile(knowledge_level="beginner", confirmed_gaps=["factoring"])
    seeded_session.topic_profile_json = profile.model_dump_json()
    db_session.add(
        LearningEvent(
            session_id=seeded_session.id,
            gap_tested="factoring",
            question="q1",
            correct=False,
        )
    )
    db_session.commit()
    session_id = seeded_session.id
    with count_queries(db_session) as q:
        messages, system_prompt, ctx = _run_prepare(db_session, session_id)
    assert q["n"] <= 7, f"prepare path used {q['n']} statements:\n" + "\n".join(q["statements"])
    # Functional proof the aggregate actually ran on this branch (not just
    # that the statement count happened to fit).
    assert "GAP_ACCURACY:" in system_prompt and "factoring" in system_prompt

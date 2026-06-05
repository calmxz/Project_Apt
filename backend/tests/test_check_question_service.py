"""TDD: check_question_service — pending-check batch state machine."""

from datetime import datetime, timezone, timedelta

import pytest

from agent.types import ToolContext
from contracts import AskCheckQuestionsArgs, TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq


SESSION_ID = "sess_1"
USER_ID = "u1"

_T0 = datetime(2026, 6, 4, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    row = SessionModel(
        id=SESSION_ID,
        user_id=USER_ID,
        topic="biology",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(row)
    db_session.commit()
    return row


# Aliases used by the new MC tests (match plan fixture names)
@pytest.fixture
def db(db_session):
    return db_session


@pytest.fixture
def session_id(session_row):
    return session_row.id


@pytest.fixture
def ctx(db_session, session_row):
    return ToolContext(
        db=db_session,
        session_id=session_row.id,
        user_id=USER_ID,
        turn_started_at=_T0,
    )


def test_is_gradable_requires_prior_turn(db_session, session_row, ctx):
    # Seed a batch using the new register API.
    args = AskCheckQuestionsArgs(
        session_id=session_row.id, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 0, "explanation": "a."}],
    )
    cq.register(db_session, ctx, args)
    same_turn = _T0
    later_turn = _T0 + timedelta(seconds=5)
    assert cq.is_gradable(db_session, session_row.id, gap="g", current_turn=same_turn) is False
    assert cq.is_gradable(db_session, session_row.id, gap="g", current_turn=later_turn) is True
    assert cq.is_gradable(db_session, session_row.id, gap="other", current_turn=later_turn) is False


def _batch_args(session_id):
    return AskCheckQuestionsArgs(
        session_id=session_id,
        gap="atp",
        items=[
            {"question": "Q1?", "options": ["2 ATP", "36 ATP"],
             "correct_index": 0, "explanation": "Net 2."},
            {"question": "Q2?", "options": ["yes", "no", "maybe"],
             "correct_index": 1, "explanation": "It is no."},
        ],
    )


def test_register_batch_persists_items_pending(db, ctx, session_id):
    res = cq.register(db, ctx, _batch_args(session_id))
    assert res.ok is True
    assert res.data == {
        "gap": "atp",
        "total": 2,
        "items": [
            {"question": "Q1?", "options": ["2 ATP", "36 ATP"]},
            {"question": "Q2?", "options": ["yes", "no", "maybe"]},
        ],
    }
    pc = cq.get_pending_check(db, session_id)
    assert pc["current_index"] == 0
    assert pc["items"][0]["status"] == "pending"
    assert pc["items"][1]["correct_index"] == 1


def test_register_rejects_second_batch_while_open(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    again = cq.register(db, ctx, _batch_args(session_id))
    assert again.ok is False
    assert "already open" in (again.error or "")


def test_register_rejects_bad_correct_index(db, ctx, session_id):
    bad = AskCheckQuestionsArgs(
        session_id=session_id, gap="g",
        items=[{"question": "q", "options": ["a", "b"],
                "correct_index": 5, "explanation": "e"}],
    )
    res = cq.register(db, ctx, bad)
    assert res.ok is False
    assert "correct_index" in (res.error or "")


def test_public_view_hides_pending_reveals_answered(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.answer(db, session_id, index=0, selected_index=1)  # wrong on Q1
    view = cq.public_view(cq.get_pending_check(db, session_id))
    assert view["current_index"] == 1
    assert view["total"] == 2
    answered, pending = view["items"][0], view["items"][1]
    assert answered["status"] == "answered"
    assert answered["selected_index"] == 1
    assert answered["correct_index"] == 0
    assert answered["correct"] is False
    assert answered["explanation"] == "Net 2."
    assert pending["status"] == "pending"
    assert pending["correct_index"] is None
    assert pending["explanation"] is None
    assert "options" in pending and "question" in pending


def test_answer_advances_and_reports_progress(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    r0 = cq.answer(db, session_id, index=0, selected_index=0)
    assert r0 == {"correct": True, "explanation": "Net 2.", "correct_index": 0,
                  "current_index": 1, "total": 2, "has_next": True, "done": False}
    r1 = cq.answer(db, session_id, index=1, selected_index=1)
    assert r1["correct"] is True
    assert r1["has_next"] is False
    assert r1["done"] is True


def test_answer_out_of_order_rejected(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    with pytest.raises(cq.CheckStateError):
        cq.answer(db, session_id, index=1, selected_index=0)


def test_answer_does_not_clear_batch(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.answer(db, session_id, index=0, selected_index=0)
    assert cq.get_pending_check(db, session_id) is not None


def test_skip_advances_no_event(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    r = cq.skip(db, session_id, index=0)
    assert r == {"current_index": 1, "total": 2, "has_next": True, "done": False}
    pc = cq.get_pending_check(db, session_id)
    assert pc["items"][0]["status"] == "skipped"


def test_is_done_true_after_last(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.skip(db, session_id, index=0)
    cq.skip(db, session_id, index=1)
    assert cq.is_done(cq.get_pending_check(db, session_id)) is True


def test_build_results_summary_mentions_misses_and_skips(db, ctx, session_id):
    cq.register(db, ctx, _batch_args(session_id))
    cq.answer(db, session_id, index=0, selected_index=1)  # wrong
    cq.skip(db, session_id, index=1)
    summary = cq.build_results_summary(cq.get_pending_check(db, session_id))
    assert "gap=atp" in summary
    assert "0/1 correct" in summary or "0/2" in summary
    assert "skipped" in summary.lower()

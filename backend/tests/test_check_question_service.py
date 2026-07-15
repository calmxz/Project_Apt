"""TDD: check_question_service — pending-check batch state machine."""

from datetime import datetime, timezone, timedelta

import pytest

from agent.types import ToolContext
from contracts import AskCheckQuestionsArgs, TopicProfile
from db.models import Session as SessionModel, User
from services import check_question_service as cq
from services import pending_check_store as pcs
from services import profile_service


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


@pytest.fixture
def ctx_fresh_session(db_session):
    """Fresh session: profile.knowledge_level is None -> diagnostic trigger."""
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
    return ToolContext(
        db=db_session,
        session_id=row.id,
        user_id=USER_ID,
        turn_started_at=_T0,
    )


@pytest.fixture
def ctx_session_with_level(db_session):
    """Session with a known knowledge_level -> normal check, not diagnostic."""
    db_session.add(User(id=USER_ID))
    db_session.flush()
    row = SessionModel(
        id=SESSION_ID,
        user_id=USER_ID,
        topic="biology",
        topic_profile_json=TopicProfile(knowledge_level="intermediate").model_dump_json(),
    )
    db_session.add(row)
    db_session.commit()
    return ToolContext(
        db=db_session,
        session_id=row.id,
        user_id=USER_ID,
        turn_started_at=_T0,
    )


def one_item_args(gap: str, correct_index: int = 0):
    return AskCheckQuestionsArgs(
        session_id=SESSION_ID,
        gap=gap,
        items=[{
            "question": f"{gap}?",
            "options": ["a", "b"],
            "correct_index": correct_index,
            "explanation": "e",
        }],
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
    assert pcs.is_gradable(db_session, session_row.id, gap="g", current_turn=same_turn) is False
    assert pcs.is_gradable(db_session, session_row.id, gap="g", current_turn=later_turn) is True
    assert pcs.is_gradable(db_session, session_row.id, gap="other", current_turn=later_turn) is False


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


def test_register_tags_diagnostic_when_level_unknown(db, ctx_fresh_session):
    # profile.knowledge_level is None on a fresh session
    cq.register(db, ctx_fresh_session, one_item_args(gap="warmup"))
    pc = cq.get_pending_check(db, ctx_fresh_session.session_id)
    assert pc["purpose"] == "diagnostic"


def test_register_tags_check_when_level_known(db, ctx_session_with_level):
    cq.register(db, ctx_session_with_level, one_item_args(gap="loops"))
    pc = cq.get_pending_check(db, ctx_session_with_level.session_id)
    assert pc["purpose"] == "check"


def test_diagnostic_correct_answer_does_not_master(db, ctx_fresh_session):
    from services import profile_service

    sid = ctx_fresh_session.session_id
    cq.register(db, ctx_fresh_session, one_item_args(gap="warmup", correct_index=0))
    cq.answer(db, sid, 0, 0)  # correct
    assert "warmup" not in (profile_service.load_profile(db, sid).mastered_concepts or [])


def test_public_view_does_not_leak_purpose(db, ctx_fresh_session):
    cq.register(db, ctx_fresh_session, one_item_args(gap="warmup"))
    pc = cq.get_pending_check(db, ctx_fresh_session.session_id)
    assert pc["purpose"] == "diagnostic"
    view = cq.public_view(pc)
    assert "purpose" not in view


def test_answer_takes_row_lock(db, ctx, session_id, monkeypatch):
    cq.register(db, ctx, _batch_args(session_id))
    calls = []
    real = profile_service.lock_session_row
    monkeypatch.setattr(
        "services.profile_service.lock_session_row",
        lambda db_, s: calls.append(s) or real(db_, s),
    )
    cq.answer(db, session_id, 0, 0)
    assert session_id in calls


def test_skip_takes_row_lock(db, ctx, session_id, monkeypatch):
    cq.register(db, ctx, _batch_args(session_id))
    calls = []
    real = profile_service.lock_session_row
    monkeypatch.setattr(
        "services.profile_service.lock_session_row",
        lambda db_, s: calls.append(s) or real(db_, s),
    )
    cq.skip(db, session_id, 0)
    assert session_id in calls


def test_abandon_open_batch_commit_false_leaves_writes_pending(db, ctx, session_id):
    """F-33: with commit=False nothing is committed -- a rollback restores the
    open batch, proving the writes joined the caller's transaction."""
    cq.register(db, ctx, _batch_args(session_id))
    assert cq.get_pending_check(db, session_id) is not None

    cleared = cq.abandon_open_batch(db, session_id, commit=False)
    assert cleared is True

    db.rollback()
    assert cq.get_pending_check(db, session_id) is not None

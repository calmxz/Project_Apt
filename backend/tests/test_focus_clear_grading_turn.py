"""Spec A5 interaction test: focus set in prior turn, graded + focus-cleared same turn.

Guard: profile_service.apply_patch with focus_clear_reason="tested_correct" requires
a correct LearningEvent with created_at >= ctx.turn_started_at. This test proves that
when the grade is logged in the SAME turn as the clear, the guard is satisfied because
LearningEvent.created_at (Python default _utcnow at INSERT) is >= turn_started_at
(set at ctx construction, which happens before the grade call).
"""

from datetime import datetime, timedelta, timezone

import pytest

from agent.types import ToolContext
from contracts import RecordLearningEventArgs, TopicProfile, UpdateTopicProfileArgs
from db.models import Session as SessionModel, User
from services import check_question_service as cq
from services import learning_event_service, profile_service


SESSION_ID = "sess_a5"
USER_ID = "u_a5"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="algorithms",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    return db_session.get(SessionModel, SESSION_ID)


@pytest.fixture
def ctx(db_session):
    return ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )


def test_grade_then_clear_focus_tested_correct_same_turn(session_row, ctx, db_session):
    """A5: focus set + question asked in a prior turn; grade + clear focus in grading turn.

    Timing proof:
    - ctx.turn_started_at = datetime.now(utc) at fixture construction (before grade call)
    - LearningEvent.created_at = _utcnow() at INSERT (after grade call)
    - Therefore LearningEvent.created_at >= ctx.turn_started_at always holds.
    - The pending check is seeded at turn_started_at-5s, satisfying the prior-turn barrier.
    """
    # Focus set in a "prior turn" — apply_patch with focus_target_gap="g"
    set_result = profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(
            session_id=ctx.session_id,
            focus_target_gap="g",
            evidence_type=None,
        ),
    )
    assert set_result.ok is True
    assert profile_service.load_profile(db_session, ctx.session_id).focus_target_gap == "g"

    # Question asked in prior turn (asked_at is before turn_started_at)
    cq.set_pending_check(
        db_session,
        ctx.session_id,
        gap="g",
        question="q?",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )

    # Grading turn: log a correct LearningEvent — created_at will be ~now >= turn_started_at
    rec = learning_event_service.record(
        db_session,
        ctx,
        RecordLearningEventArgs(
            session_id=ctx.session_id,
            gap_tested="g",
            question="q?",
            correct=True,
        ),
    )
    assert rec.ok is True

    # Clear focus with reason "tested_correct" — guard must find the event logged above
    clr = profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(
            session_id=ctx.session_id,
            focus_target_gap=None,
            focus_clear_reason="tested_correct",
            evidence_type=None,
        ),
    )
    assert clr.ok is True
    assert profile_service.load_profile(db_session, ctx.session_id).focus_target_gap is None


def test_clear_focus_tested_correct_with_divergent_gap_label(session_row, ctx, db_session):
    """A correct grade clears focus even when the check-question gap label differs
    from focus_target_gap.

    The model picks the check-question `gap` independently of `focus_target_gap`,
    so the two labels routinely diverge (e.g. focus "electron transport chain" vs
    check "electron transport chain location"). The tested_correct guard is temporal
    per CLAUDE.md ("a correct LearningEvent was logged that turn"), not gap-exact, so
    a correct event this turn satisfies the clear.
    """
    focus_gap = "electron transport chain"
    check_gap = "electron transport chain location"

    profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(session_id=ctx.session_id, focus_target_gap=focus_gap),
    )
    cq.set_pending_check(
        db_session,
        ctx.session_id,
        gap=check_gap,
        question="Where does the ETC occur?",
        options=["mitochondria", "cytoplasm"], correct_index=0, explanation="mitochondria.",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )
    rec = learning_event_service.record(
        db_session,
        ctx,
        RecordLearningEventArgs(
            session_id=ctx.session_id,
            gap_tested=check_gap,
            question="Where does the ETC occur?",
            correct=True,
        ),
    )
    assert rec.ok is True

    clr = profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(
            session_id=ctx.session_id,
            focus_target_gap=None,
            focus_clear_reason="tested_correct",
        ),
    )
    assert clr.ok is True, clr.error
    assert profile_service.load_profile(db_session, ctx.session_id).focus_target_gap is None

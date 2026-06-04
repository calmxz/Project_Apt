"""Spec A5 interaction test: focus set in prior turn, cleared same or later turn.

Previously, clearing focus_target_gap with focus_clear_reason="tested_correct" required
the server to find a correct LearningEvent logged in the same turn (created_at >=
ctx.turn_started_at). That guard is removed: record_learning_event is no longer an LLM
tool, so the LLM cannot fabricate a LearningEvent, and the ask-and-self-grade exploit
the guard prevented is impossible. Mastery is now server-authoritative (record_from_answer).

The remaining rule: clearing focus WITHOUT a focus_clear_reason still FAILS.
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


def test_tested_correct_clear_no_longer_requires_in_turn_event(session_row, ctx, db_session):
    """Guard removed: tested_correct clears focus with no in-turn LearningEvent at all.

    Previously this would have FAILED (guard required a correct LearningEvent this turn).
    Now it succeeds because the guard is gone: record_learning_event is a human click,
    not an LLM tool, so the exploit the guard defended against is no longer possible.
    """
    profile = profile_service.load_profile(db_session, SESSION_ID)
    profile.focus_target_gap = "atp"
    profile_service.save_profile(db_session, SESSION_ID, profile)

    res = profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(
            session_id=ctx.session_id,
            focus_target_gap=None,
            focus_clear_reason="tested_correct",
            evidence_type="tested",
        ),
    )
    assert res.ok is True
    assert profile_service.load_profile(db_session, ctx.session_id).focus_target_gap is None


def test_grade_then_clear_focus_tested_correct_same_turn(session_row, ctx, db_session):
    """A5: focus set + question asked in a prior turn; grade + clear focus in grading turn.

    The in-turn LearningEvent is no longer required by the guard (which is removed), but
    grading still works correctly and focus still clears. This test confirms the full
    grading-then-clear flow remains valid end-to-end.
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

    # Grading turn: log a correct LearningEvent (now via human click / record_from_answer)
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

    # Clear focus with reason "tested_correct" — succeeds without needing the guard
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
    """Correct grade clears focus even when the check-question gap label differs from focus_target_gap.

    The model picks the check-question `gap` independently of `focus_target_gap`,
    so the two labels routinely diverge. With the guard removed, divergent gap labels
    are a non-issue: no LearningEvent lookup is performed at all.
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


def test_clear_focus_without_reason_still_fails(session_row, ctx, db_session):
    """Clearing focus WITHOUT a focus_clear_reason still FAILS. This rule is kept."""
    set_result = profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(
            session_id=ctx.session_id,
            focus_target_gap="some_gap",
            evidence_type=None,
        ),
    )
    assert set_result.ok is True

    clr = profile_service.apply_patch(
        db_session,
        ctx,
        UpdateTopicProfileArgs(
            session_id=ctx.session_id,
            focus_target_gap=None,
            focus_clear_reason=None,
            evidence_type=None,
        ),
    )
    assert clr.ok is False
    assert "focus_clear_reason required" in clr.error
    # Focus must remain set
    assert profile_service.load_profile(db_session, ctx.session_id).focus_target_gap == "some_gap"

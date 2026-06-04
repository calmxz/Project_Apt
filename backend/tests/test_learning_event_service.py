"""TDD: learning_event_service.record + demotion side effect."""

from datetime import datetime, timedelta, timezone

import pytest

from agent.types import ToolContext
from contracts import RecordLearningEventArgs, TopicProfile
from db.models import LearningEvent, Session as SessionModel, User
from services import check_question_service as cq
from services import learning_event_service, profile_service


SESSION_ID = "sess_1"
USER_ID = "u1"


@pytest.fixture
def session_row(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile(
                mastered_concepts=["joins"]
            ).model_dump_json(),
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


def _args(**kw) -> RecordLearningEventArgs:
    kw.setdefault("session_id", SESSION_ID)
    kw.setdefault("gap_tested", "indexes")
    kw.setdefault("question", "what is a btree?")
    kw.setdefault("correct", True)
    return RecordLearningEventArgs(**kw)


def test_correct_event_recorded(session_row, ctx, db_session):
    # A prior-turn pending check is required by the grading guard.
    cq.set_pending_check(
        db_session,
        SESSION_ID,
        gap="indexes",
        question="what is a btree?",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )
    result = learning_event_service.record(db_session, ctx, _args(correct=True))
    assert result.ok is True
    assert result.status == "ok"
    rows = db_session.query(LearningEvent).all()
    assert len(rows) == 1
    assert rows[0].correct is True


def test_incorrect_on_non_mastered_does_not_demote(session_row, ctx, db_session):
    # A prior-turn pending check is required by the grading guard.
    cq.set_pending_check(
        db_session,
        SESSION_ID,
        gap="indexes",
        question="what is a btree?",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )
    result = learning_event_service.record(
        db_session, ctx, _args(gap_tested="indexes", correct=False)
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert profile.mastered_concepts == ["joins"]


def test_incorrect_on_mastered_demotes(session_row, ctx, db_session):
    # A prior-turn pending check is required by the grading guard.
    cq.set_pending_check(
        db_session,
        SESSION_ID,
        gap="joins",
        question="what is a join?",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )
    result = learning_event_service.record(
        db_session, ctx, _args(gap_tested="joins", correct=False)
    )
    assert result.ok is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "joins" not in profile.mastered_concepts
    assert cq.get_pending_check(db_session, SESSION_ID) is None


# --- Grading guard tests (Task 8) ---


def test_grade_rejected_without_pending_check(session_row, ctx, db_session):
    args = RecordLearningEventArgs(
        session_id=SESSION_ID, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db_session, ctx, args)
    assert result.ok is False
    assert "no open check-question" in (result.error or "").lower()


def test_grade_rejected_when_asked_this_turn(session_row, ctx, db_session):
    cq.set_pending_check(
        db_session, SESSION_ID, gap="g", question="q?",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=ctx.turn_started_at,
    )
    args = RecordLearningEventArgs(
        session_id=SESSION_ID, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db_session, ctx, args)
    assert result.ok is False
    assert cq.get_pending_check(db_session, SESSION_ID) is not None


def test_grade_accepted_from_prior_turn_and_clears(session_row, ctx, db_session):
    cq.set_pending_check(
        db_session,
        SESSION_ID,
        gap="g",
        question="q?",
        options=["a", "b"], correct_index=0, explanation="a.",
        asked_at=ctx.turn_started_at - timedelta(seconds=5),
    )
    args = RecordLearningEventArgs(
        session_id=SESSION_ID, gap_tested="g", question="q?", correct=True
    )
    result = learning_event_service.record(db_session, ctx, args)
    assert result.ok is True
    assert result.data["correct"] is True
    assert cq.get_pending_check(db_session, SESSION_ID) is None


# --- record_from_answer tests (Task 3: deterministic click path) ---


def test_record_from_answer_correct_adds_mastered_and_clears(session_row, db_session):
    cq.set_pending_check(
        db_session, SESSION_ID, gap="atp", question="q?", options=["a", "b"],
        correct_index=0, explanation="e", asked_at=datetime(2026, 1, 1),
    )
    event = learning_event_service.record_from_answer(
        db_session, SESSION_ID, gap="atp", question="q?", correct=True,
    )
    assert event.correct is True
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "atp" in profile.mastered_concepts
    assert cq.get_pending_check(db_session, SESSION_ID) is None


def test_record_from_answer_incorrect_demotes_mastered(session_row, db_session):
    profile = profile_service.load_profile(db_session, SESSION_ID)
    profile.mastered_concepts = ["atp"]
    profile_service.save_profile(db_session, SESSION_ID, profile)
    cq.set_pending_check(
        db_session, SESSION_ID, gap="atp", question="q?", options=["a", "b"],
        correct_index=0, explanation="e", asked_at=datetime(2026, 1, 1),
    )
    learning_event_service.record_from_answer(
        db_session, SESSION_ID, gap="atp", question="q?", correct=False,
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "atp" not in profile.mastered_concepts


def test_record_from_answer_incorrect_non_mastered_is_noop_on_profile(session_row, db_session):
    cq.set_pending_check(
        db_session, SESSION_ID, gap="krebs", question="q?", options=["a", "b"],
        correct_index=0, explanation="e", asked_at=datetime(2026, 1, 1),
    )
    learning_event_service.record_from_answer(
        db_session, SESSION_ID, gap="krebs", question="q?", correct=False,
    )
    profile = profile_service.load_profile(db_session, SESSION_ID)
    assert "krebs" not in (profile.mastered_concepts or [])

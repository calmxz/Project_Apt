"""plan_revision_service.maybe_suggest_lesson — deterministic struggle signal."""

from db.models import (
    Lesson, LearningEvent, Session as SessionModel, Subject, User,
)
from services import plan_revision_service
from services.plan_revision_service import STRUGGLE_THRESHOLD

USER_ID = "u_pr"


def _wrong(db, session_id, gap, n):
    for _ in range(n):
        db.add(LearningEvent(session_id=session_id, gap_tested=gap,
                             question="q", correct=False))
    db.commit()


def _subject_session(db, *, subject_id="sub1", session_id="s0", lesson_id="l0"):
    db.add(User(id=USER_ID))
    db.add(Subject(id=subject_id, user_id=USER_ID, title="Chem",
                   per_session_minutes=30, timeline_days=14,
                   duration_mode="deadline"))
    db.add(SessionModel(id=session_id, user_id=USER_ID, topic="Alkanes",
                        subject_id=subject_id))
    db.add(Lesson(id=lesson_id, subject_id=subject_id, order_idx=0, title="Alkanes",
                  goal="g", status="in_progress", session_id=session_id))
    db.commit()


def test_fires_exactly_at_threshold(db_session):
    _subject_session(db_session)
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD)
    out = plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes")
    assert out is not None
    assert out.subject_id == "sub1"
    assert out.lesson_id == "l0"
    assert out.gap == "alkanes"
    assert out.suggested_title == "alkanes practice"


def test_no_fire_below_threshold(db_session):
    _subject_session(db_session)
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD - 1)
    assert plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes") is None


def test_fires_once_then_suppressed_above_threshold(db_session):
    _subject_session(db_session)
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD + 1)
    # crossing already passed -> does not re-fire on later misses
    assert plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes") is None


def test_quick_session_no_subject_no_op(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(SessionModel(id="q0", user_id=USER_ID, topic="x", subject_id=None))
    db_session.commit()
    _wrong(db_session, "q0", "alkanes", STRUGGLE_THRESHOLD)
    assert plan_revision_service.maybe_suggest_lesson(db_session, "q0", "alkanes") is None


def test_existing_practice_lesson_suppresses(db_session):
    _subject_session(db_session)
    db_session.add(Lesson(id="lp", subject_id="sub1", order_idx=1,
                          title="alkanes practice", goal="g",
                          status="not_started", session_id=None))
    db_session.commit()
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD)
    assert plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes") is None

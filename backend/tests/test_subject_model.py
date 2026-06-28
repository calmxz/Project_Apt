"""TDD: Subject + Lesson ORM models and Session.subject_id column."""

import pytest
from sqlalchemy.exc import IntegrityError

from db.models import Lesson, Session as SessionModel, Subject, User


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def test_create_subject_with_lesson(db_session, seeded_user):
    subj = Subject(
        user_id=USER_ID,
        title="Organic Chemistry",
        per_session_minutes=30,
        duration_mode="deadline",
        timeline_days=14,
    )
    db_session.add(subj)
    db_session.flush()
    lesson = Lesson(subject_id=subj.id, order_idx=0, title="Bonding", goal="learn bonds")
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)
    assert lesson.status == "not_started"
    assert lesson.session_id is None
    assert subj.duration_mode == "deadline"
    assert subj.timeline_days == 14
    assert subj.pace_per_week is None  # pace is derived in deadline mode
    assert subj.archived_at is None
    assert lesson.subject_id == subj.id


def test_lesson_status_check_constraint(db_session, seeded_user):
    subj = Subject(
        user_id=USER_ID, title="X", per_session_minutes=15, duration_mode="pace", pace_per_week=3
    )
    db_session.add(subj)
    db_session.flush()
    db_session.add(Lesson(subject_id=subj.id, order_idx=0, title="bad", goal="g", status="nope"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_subject_duration_mode_check_constraint(db_session, seeded_user):
    db_session.add(
        Subject(user_id=USER_ID, title="bad", per_session_minutes=30, duration_mode="whenever")
    )
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_session_subject_id_nullable_and_settable(db_session, seeded_user):
    # Existing rows stay NULL = quick lesson.
    quick = SessionModel(id="s_quick", user_id=USER_ID, topic="recursion")
    db_session.add(quick)
    db_session.commit()
    assert quick.subject_id is None

    subj = Subject(
        user_id=USER_ID, title="Y", per_session_minutes=60, duration_mode="pace", pace_per_week=2
    )
    db_session.add(subj)
    db_session.flush()
    linked = SessionModel(id="s_linked", user_id=USER_ID, topic="bonds", subject_id=subj.id)
    db_session.add(linked)
    db_session.commit()
    assert linked.subject_id == subj.id

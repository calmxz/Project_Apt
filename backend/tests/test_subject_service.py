"""TDD: subject_service persistence + ordering + open-lesson dual-pointer."""

import pytest

from contracts import LessonDraft
from db.models import Lesson, Session as SessionModel, User
from services import subject_service


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


def _subject(db_session, drafts, duration_mode="deadline", timeline_days=14, pace_per_week=None):
    return subject_service.create_subject(
        db_session, USER_ID, "Organic Chem", 30,
        duration_mode, timeline_days, pace_per_week, drafts,
    )


def test_create_subject_with_lessons_transaction(db_session, seeded_user):
    drafts = [LessonDraft(title="Bonding", goal="g1"), LessonDraft(title="Alkanes", goal="g2")]
    subj = _subject(db_session, drafts)
    lessons = subject_service.list_lessons(db_session, subj.id)
    assert [l.order_idx for l in lessons] == [0, 1]
    assert [l.title for l in lessons] == ["Bonding", "Alkanes"]
    assert all(l.status == "not_started" for l in lessons)


def test_progress_counts(db_session, seeded_user):
    subj = _subject(db_session, [LessonDraft(title="a", goal=""), LessonDraft(title="b", goal="")])
    lessons = subject_service.list_lessons(db_session, subj.id)
    subject_service.patch_lesson(db_session, lessons[0], status="done")
    done, total = subject_service.progress_counts(db_session, subj.id)
    assert (done, total) == (1, 2)


def test_derive_duration_deadline_mode():
    # deadline pinned: pace_per_week = ceil(lesson_count / max(timeline_days/7, 1))
    td, pace = subject_service.derive_duration("deadline", 6, 14, None)
    assert (td, pace) == (14, 3)            # ceil(6 / 2 weeks)
    td, pace = subject_service.derive_duration("deadline", 2, 3, None)
    assert (td, pace) == (3, 2)             # weeks floored to 1 -> ceil(2/1)
    td, pace = subject_service.derive_duration("deadline", 0, 14, None)
    assert (td, pace) == (14, 0)            # lesson_count=0 -> derived pace 0


def test_derive_duration_pace_mode():
    # pace pinned: timeline_days = ceil(lesson_count / max(pace_per_week, 1)) * 7
    td, pace = subject_service.derive_duration("pace", 6, None, 2)
    assert (td, pace) == (21, 2)            # ceil(6/2)=3 weeks -> 21 days
    td, pace = subject_service.derive_duration("pace", 0, None, 3)
    assert (td, pace) == (0, 3)            # lesson_count=0 -> derived days 0


def test_derive_duration_divide_by_zero_guards():
    # pace_per_week=0 must not raise (guarded by max(..., 1))
    td, pace = subject_service.derive_duration("pace", 5, None, 0)
    assert td == 35 and pace == 0          # ceil(5/1)=5 weeks -> 35 days
    # timeline_days=0 must not raise (weeks floored to 1)
    td, pace = subject_service.derive_duration("deadline", 5, 0, None)
    assert td == 0 and pace == 5           # ceil(5/1)


def test_add_lesson_appends_at_end(db_session, seeded_user):
    subj = _subject(db_session, [LessonDraft(title="a", goal="")])
    added = subject_service.add_lesson(db_session, subj, "b", "goal-b")
    assert added.order_idx == 1
    assert [l.title for l in subject_service.list_lessons(db_session, subj.id)] == ["a", "b"]


def test_reorder_compacts_siblings(db_session, seeded_user):
    subj = _subject(
        db_session,
        [LessonDraft(title="a", goal=""), LessonDraft(title="b", goal=""), LessonDraft(title="c", goal="")],
    )
    lessons = subject_service.list_lessons(db_session, subj.id)
    # move "c" (idx 2) to front
    subject_service.patch_lesson(db_session, lessons[2], order_idx=0)
    ordered = subject_service.list_lessons(db_session, subj.id)
    assert [l.title for l in ordered] == ["c", "a", "b"]
    assert [l.order_idx for l in ordered] == [0, 1, 2]


def test_open_lesson_dual_pointer_and_idempotent(db_session, seeded_user):
    subj = _subject(db_session, [LessonDraft(title="Bonding", goal="g")])
    lesson = subject_service.list_lessons(db_session, subj.id)[0]
    sess = subject_service.open_lesson(db_session, USER_ID, lesson)
    assert sess.subject_id == subj.id
    assert sess.topic == "Bonding"
    assert lesson.session_id == sess.id
    assert lesson.status == "in_progress"
    # idempotent: opening again returns the same session
    sess2 = subject_service.open_lesson(db_session, USER_ID, lesson)
    assert sess2.id == sess.id


def test_delete_lesson_without_session(db_session, seeded_user):
    subj = _subject(db_session, [LessonDraft(title="a", goal="")])
    lesson = subject_service.list_lessons(db_session, subj.id)[0]
    subject_service.delete_lesson(db_session, lesson)
    assert subject_service.list_lessons(db_session, subj.id) == []


def test_delete_lesson_with_session_raises(db_session, seeded_user):
    subj = _subject(db_session, [LessonDraft(title="a", goal="")])
    lesson = subject_service.list_lessons(db_session, subj.id)[0]
    subject_service.open_lesson(db_session, USER_ID, lesson)
    with pytest.raises(subject_service.LessonHasSessionError):
        subject_service.delete_lesson(db_session, lesson)


def test_delete_lesson_force_ends_session_and_deletes(db_session, seeded_user):
    subj = _subject(db_session, [LessonDraft(title="a", goal="")])
    lesson = subject_service.list_lessons(db_session, subj.id)[0]
    sess = subject_service.open_lesson(db_session, USER_ID, lesson)
    lesson_id = lesson.id
    subject_service.delete_lesson(db_session, lesson, force=True)
    # lesson gone
    assert db_session.get(Lesson, lesson_id) is None
    # session ended (not deleted)
    refreshed = db_session.get(SessionModel, sess.id)
    assert refreshed is not None
    assert refreshed.ended_at is not None


def test_get_subject_cross_user_none(db_session, seeded_user):
    subj = _subject(db_session, [])
    assert subject_service.get_subject(db_session, "other", subj.id) is None


def test_create_subject_auto_creates_user(db_session):
    """Verify create_subject auto-creates the User row when it doesn't exist."""
    fresh_user = "fresh_user"
    # Ensure user does not exist
    assert db_session.get(User, fresh_user) is None
    # Call create_subject with a non-existent user
    subj = subject_service.create_subject(
        db_session, fresh_user, "T", 30, "deadline", 14, None, []
    )
    # Assert subject belongs to the fresh user
    assert subj.user_id == fresh_user
    # Assert user was auto-created
    assert db_session.get(User, fresh_user) is not None


def test_get_lesson_cross_user_none(db_session, seeded_user):
    """Verify get_lesson returns None on cross-user access."""
    subj = _subject(db_session, [LessonDraft(title="Test Lesson", goal="goal")])
    lesson = subject_service.list_lessons(db_session, subj.id)[0]
    # Cross-user access should return None
    assert subject_service.get_lesson(db_session, "other_user", lesson.id) is None
    # Same-user access should return the lesson
    assert subject_service.get_lesson(db_session, USER_ID, lesson.id) is not None

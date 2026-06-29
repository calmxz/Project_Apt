"""Subject and lesson persistence (mirrors routes/sessions.py service patterns).

Create-with-lessons in one transaction, list, read-with-progress, add/patch/
reorder/delete lesson, and lazy open-lesson (creates a session and links both
the lesson.session_id and sessions.subject_id pointers atomically).
"""

import math
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from contracts import LessonDraft, TopicProfile
from db.models import Lesson, Session as SessionModel, Subject, User


class LessonHasSessionError(Exception):
    """Raised when deleting a lesson that already owns a chat session."""


def create_subject(
    db: Session,
    user_id: str,
    title: str,
    per_session_minutes: int,
    duration_mode: str,
    timeline_days: int | None,
    pace_per_week: int | None,
    lessons: list[LessonDraft],
) -> Subject:
    if not db.get(User, user_id):
        db.add(User(id=user_id))
        db.flush()
    subject = Subject(
        id=uuid.uuid4().hex,
        user_id=user_id,
        title=title,
        per_session_minutes=per_session_minutes,
        duration_mode=duration_mode,
        timeline_days=timeline_days,
        pace_per_week=pace_per_week,
    )
    db.add(subject)
    db.flush()
    for idx, draft in enumerate(lessons):
        db.add(
            Lesson(
                id=uuid.uuid4().hex,
                subject_id=subject.id,
                order_idx=idx,
                title=draft.title,
                goal=draft.goal,
                status="not_started",
            )
        )
    db.commit()
    db.refresh(subject)
    return subject


def list_subjects(db: Session, user_id: str) -> list[Subject]:
    return list(
        db.execute(
            select(Subject)
            .where(Subject.user_id == user_id)
            .order_by(Subject.created_at.desc())
        ).scalars().all()
    )


def get_subject(db: Session, user_id: str, subject_id: str) -> Subject | None:
    subject = db.get(Subject, subject_id)
    if subject is None or subject.user_id != user_id:
        return None
    return subject


def list_lessons(db: Session, subject_id: str) -> list[Lesson]:
    return list(
        db.execute(
            select(Lesson)
            .where(Lesson.subject_id == subject_id)
            .order_by(Lesson.order_idx.asc())
        ).scalars().all()
    )


def progress_counts(db: Session, subject_id: str) -> tuple[int, int]:
    rows = db.execute(
        select(Lesson.status, func.count())
        .where(Lesson.subject_id == subject_id)
        .group_by(Lesson.status)
    ).all()
    by_status = {status: n for status, n in rows}
    total = sum(by_status.values())
    return by_status.get("done", 0), total


def derive_duration(
    duration_mode: str,
    lesson_count: int,
    timeline_days: int | None,
    pace_per_week: int | None,
) -> tuple[int, int]:
    """Return the full (timeline_days, pace_per_week) pair, deriving the
    complementary value from the CURRENT lesson_count so it stays correct as
    plan-revision (Spec C) adds/removes lessons. Pure; no DB access.

    deadline mode (timeline_days pinned):
        pace_per_week = ceil(lesson_count / max(timeline_days / 7, 1))
    pace mode (pace_per_week pinned):
        timeline_days = ceil(lesson_count / max(pace_per_week, 1)) * 7
    """
    if duration_mode == "deadline":
        weeks = max((timeline_days or 0) / 7, 1)
        derived_pace = math.ceil(lesson_count / weeks)
        return timeline_days or 0, derived_pace
    # pace mode
    derived_days = math.ceil(lesson_count / max(pace_per_week or 0, 1)) * 7
    return derived_days, pace_per_week or 0


def add_lesson(db: Session, subject: Subject, title: str, goal: str) -> Lesson:
    existing = list_lessons(db, subject.id)
    next_idx = existing[-1].order_idx + 1 if existing else 0
    lesson = Lesson(
        id=uuid.uuid4().hex,
        subject_id=subject.id,
        order_idx=next_idx,
        title=title,
        goal=goal,
        status="not_started",
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


def get_lesson(db: Session, user_id: str, lesson_id: str) -> Lesson | None:
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        return None
    subject = db.get(Subject, lesson.subject_id)
    if subject is None or subject.user_id != user_id:
        return None
    return lesson


def _reorder(db: Session, lesson: Lesson, new_idx: int) -> None:
    siblings = [s for s in list_lessons(db, lesson.subject_id) if s.id != lesson.id]
    new_idx = max(0, min(new_idx, len(siblings)))
    siblings.insert(new_idx, lesson)
    for i, s in enumerate(siblings):
        s.order_idx = i


def patch_lesson(
    db: Session,
    lesson: Lesson,
    title: str | None = None,
    goal: str | None = None,
    status: str | None = None,
    order_idx: int | None = None,
) -> Lesson:
    if title is not None:
        lesson.title = title
    if goal is not None:
        lesson.goal = goal
    if status is not None:
        lesson.status = status
    if order_idx is not None:
        _reorder(db, lesson, order_idx)
    db.commit()
    db.refresh(lesson)
    return lesson


def delete_lesson(db: Session, lesson: Lesson, force: bool = False) -> None:
    if lesson.session_id is not None:
        if not force:
            raise LessonHasSessionError("lesson has a session")
        # force: end the session and clear the pointer before deleting the lesson.
        session = db.get(SessionModel, lesson.session_id)
        if session is not None and session.ended_at is None:
            session.ended_at = datetime.now(timezone.utc)
        lesson.session_id = None
        db.flush()
    db.delete(lesson)
    db.commit()


def open_lesson(db: Session, user_id: str, lesson: Lesson) -> SessionModel:
    if lesson.session_id is not None:
        return db.get(SessionModel, lesson.session_id)
    session = SessionModel(
        id=uuid.uuid4().hex,
        user_id=user_id,
        topic=lesson.title,
        subject_id=lesson.subject_id,
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db.add(session)
    db.flush()
    lesson.session_id = session.id
    lesson.status = "in_progress"
    db.commit()
    db.refresh(session)
    db.refresh(lesson)
    return session

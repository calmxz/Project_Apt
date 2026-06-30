"""Tutor-suggested practice lesson — deterministic, server-side.

When a learner repeatedly misses one gap inside a subject (lesson-backed)
session, surface a one-time suggestion to add a short practice lesson. The
signal reuses LearningEvent history (incorrect count per gap) — no new
tracking. The cap is once-per-GAP (a multi-gap lesson may suggest per distinct
gap): we fire only on the crossing (count == STRUGGLE_THRESHOLD), and a durable
post-Add suppressor is the existence of a lesson already titled like the
practice lesson. "No thanks" is a client-side dismissal, not a server cap.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from contracts import AddLessonSuggestion
from db.models import Lesson, LearningEvent, Session as SessionModel

STRUGGLE_THRESHOLD = 2


def _practice_title(gap: str) -> str:
    return f"{gap} practice"


def maybe_suggest_lesson(
    db: Session, session_id: str, gap: str
) -> AddLessonSuggestion | None:
    if not gap:
        return None
    sess = db.get(SessionModel, session_id)
    if sess is None or sess.subject_id is None:
        return None  # quick (subject-less) session -> never suggest

    # Only check_question_service.answer() ever writes an incorrect LearningEvent
    # (+1 per wrong answer), so `== STRUGGLE_THRESHOLD` fires exactly once on the
    # crossing. If a second source of incorrect events is ever added, revisit this.
    incorrect = db.execute(
        select(func.count(LearningEvent.id)).where(
            LearningEvent.session_id == session_id,
            LearningEvent.gap_tested == gap,
            LearningEvent.correct.is_(False),
        )
    ).scalar_one()
    # Fire ONCE, exactly on the crossing. Below -> too early; above -> already fired.
    if incorrect != STRUGGLE_THRESHOLD:
        return None

    lesson = db.execute(
        select(Lesson).where(
            Lesson.subject_id == sess.subject_id,
            Lesson.session_id == session_id,
        )
    ).scalars().first()
    if lesson is None:
        return None  # session not linked to a lesson in this subject

    title = _practice_title(gap)
    # Durable suppressor: do not re-suggest if a practice lesson already exists.
    existing = db.execute(
        select(func.count(Lesson.id)).where(
            Lesson.subject_id == sess.subject_id,
            Lesson.title == title,
        )
    ).scalar_one()
    if existing:
        return None

    return AddLessonSuggestion(
        subject_id=sess.subject_id,
        lesson_id=lesson.id,
        gap=gap,
        suggested_title=title,
        suggested_goal=f"Extra practice on {gap}.",
    )

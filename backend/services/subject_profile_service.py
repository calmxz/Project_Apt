"""Subject-level mastery map. Pure SQL + Python, no LLM calls.

Reuses the aggregation approach from profile_service.aggregate_for_user:
walk the subject's lessons (ordered) -> their linked sessions ->
topic_profile_json (parsed tolerantly via _parse_profile) -> union + dedupe
mastered and gaps. open_gaps is disjoint from mastered_concepts at the subject
level (a concept mastered anywhere in the subject is not also "still shaky").
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import SubjectLessonRollup, SubjectProfileResponse
from db.models import Lesson, Session as SessionModel, Subject
from services.profile_service import _parse_profile


def _dedupe(seq: list[str]) -> list[str]:
    """Order-preserving dedupe."""
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def aggregate_for_subject(db: Session, subject_id: str) -> SubjectProfileResponse | None:
    subject = db.get(Subject, subject_id)
    if subject is None:
        return None

    lessons: list[Lesson] = db.execute(
        select(Lesson)
        .where(Lesson.subject_id == subject_id)
        .order_by(Lesson.order_idx.asc())
    ).scalars().all()

    rollups: list[SubjectLessonRollup] = []
    all_mastered: list[str] = []
    all_gaps: list[str] = []

    for lesson in lessons:
        mastered: list[str] = []
        gaps: list[str] = []
        if lesson.session_id is not None:
            sess = db.get(SessionModel, lesson.session_id)
            if sess is not None:
                profile = _parse_profile(sess.topic_profile_json)
                mastered = list(profile.mastered_concepts or [])
                gaps = list(profile.confirmed_gaps or [])
        rollups.append(
            SubjectLessonRollup(
                lesson_id=lesson.id,
                lesson_title=lesson.title,
                mastered=mastered,
                gaps=gaps,
            )
        )
        all_mastered.extend(mastered)
        all_gaps.extend(gaps)

    mastered_union = _dedupe(all_mastered)
    mastered_set = set(mastered_union)
    open_gaps = [g for g in _dedupe(all_gaps) if g not in mastered_set]

    return SubjectProfileResponse(
        subject_id=subject.id,
        subject_title=subject.title,
        mastered_concepts=mastered_union,
        open_gaps=open_gaps,
        lessons=rollups,
    )

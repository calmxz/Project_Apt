from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from contracts import (
    LessonCreateRequest,
    LessonItem,
    LessonOpenResponse,
    LessonUpdateRequest,
    SubjectCreateRequest,
    SubjectDetail,
    SubjectListItem,
    SubjectProgress,
    SubjectProfileResponse,
    SubjectUpdateRequest,
)
from db.database import get_db
from db.models import Lesson, Subject
from lib.error_codes import (
    DURATION_FIELD_REQUIRED,
    LESSON_HAS_SESSION,
    LESSON_NOT_FOUND,
    SUBJECT_NOT_FOUND,
)
from services import plan_service, subject_profile_service, subject_service
from services.auth import current_user_id
from services.session_enrichment import aware_utc as _aware_utc

router = APIRouter(prefix="/api")

ALLOWED_STATUS = {"not_started", "in_progress", "done"}
ALLOWED_DURATION_MODE = {"deadline", "pace"}


def _lesson_item(lesson: Lesson) -> LessonItem:
    return LessonItem(
        id=lesson.id,
        subject_id=lesson.subject_id,
        order_idx=lesson.order_idx,
        title=lesson.title,
        goal=lesson.goal,
        status=lesson.status,
        session_id=lesson.session_id,
        created_at=_aware_utc(lesson.created_at),
    )


def _subject_detail(db: Session, subject: Subject) -> SubjectDetail:
    lessons = subject_service.list_lessons(db, subject.id)
    done, total = subject_service.progress_counts(db, subject.id)
    # Derive the complementary duration value from the current lesson_count so the
    # response carries both the pinned and the derived value plus duration_mode.
    timeline_days, pace_per_week = subject_service.derive_duration(
        subject.duration_mode, total, subject.timeline_days, subject.pace_per_week
    )
    return SubjectDetail(
        id=subject.id,
        user_id=subject.user_id,
        title=subject.title,
        per_session_minutes=subject.per_session_minutes,
        duration_mode=subject.duration_mode,
        timeline_days=timeline_days,
        pace_per_week=pace_per_week,
        created_at=_aware_utc(subject.created_at),
        archived_at=_aware_utc(subject.archived_at),
        progress=SubjectProgress(done_count=done, total_count=total),
        lessons=[_lesson_item(l) for l in lessons],
    )


@router.post("/subjects", response_model=SubjectDetail, status_code=status.HTTP_201_CREATED)
async def create_subject(
    req: SubjectCreateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    # Enforce duration invariant: the mode's pinned field must be provided.
    if req.duration_mode == "deadline" and req.timeline_days is None:
        raise HTTPException(status_code=400, detail=DURATION_FIELD_REQUIRED)
    if req.duration_mode == "pace" and req.pace_per_week is None:
        raise HTTPException(status_code=400, detail=DURATION_FIELD_REQUIRED)
    # Null the complement so only the pinned field is stored.
    timeline_days = req.timeline_days if req.duration_mode == "deadline" else None
    pace_per_week = req.pace_per_week if req.duration_mode == "pace" else None
    if req.mode == "draft":
        drafts = await plan_service.draft_plan(
            db, user_id, req.title, req.per_session_minutes,
            req.duration_mode, timeline_days, pace_per_week,
        )
    else:
        drafts = req.lessons or []
    subject = subject_service.create_subject(
        db, user_id, req.title, req.per_session_minutes,
        req.duration_mode, timeline_days, pace_per_week, drafts,
    )
    return _subject_detail(db, subject)


@router.get("/subjects", response_model=list[SubjectListItem])
def list_subjects(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    out: list[SubjectListItem] = []
    for s in subject_service.list_subjects(db, user_id):
        done, total = subject_service.progress_counts(db, s.id)
        out.append(
            SubjectListItem(
                id=s.id,
                title=s.title,
                archived=s.archived_at is not None,
                progress=SubjectProgress(done_count=done, total_count=total),
            )
        )
    return out



@router.get("/subjects/{subject_id}", response_model=SubjectDetail)
def get_subject(
    subject_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    subject = subject_service.get_subject(db, user_id, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND)
    return _subject_detail(db, subject)


@router.get("/subjects/{subject_id}/profile", response_model=SubjectProfileResponse)
def get_subject_profile(
    subject_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    subject = db.get(Subject, subject_id)
    if subject is None or subject.user_id != user_id:
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND)
    result = subject_profile_service.aggregate_for_subject(db, subject_id)
    if result is None:  # defensive; ownership already checked above
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND)
    return result


@router.patch("/subjects/{subject_id}", response_model=SubjectDetail)
def update_subject(
    subject_id: str,
    req: SubjectUpdateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    if (
        req.title is None
        and req.duration_mode is None
        and req.timeline_days is None
        and req.pace_per_week is None
        and req.archived is None
    ):
        raise HTTPException(status_code=400, detail="at least one field required")
    # Defense-in-depth; the contract Literal already rejects bad values with 422.
    if req.duration_mode is not None and req.duration_mode not in ALLOWED_DURATION_MODE:
        raise HTTPException(status_code=400, detail="invalid duration_mode")
    subject = subject_service.get_subject(db, user_id, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND)
    if req.title is not None:
        subject.title = req.title
    # Changing duration: the new mode pins one field; clear the other so exactly
    # one stays populated (the complement is derived on read).
    if req.duration_mode is not None:
        subject.duration_mode = req.duration_mode
        if req.duration_mode == "deadline":
            if req.timeline_days is not None:
                subject.timeline_days = req.timeline_days
            subject.pace_per_week = None
        else:  # pace
            if req.pace_per_week is not None:
                subject.pace_per_week = req.pace_per_week
            subject.timeline_days = None
        # Guard: the new mode must have its pinned field populated (from the
        # request or from the existing row if mode is unchanged).
        if req.duration_mode == "deadline" and subject.timeline_days is None:
            raise HTTPException(status_code=400, detail=DURATION_FIELD_REQUIRED)
        if req.duration_mode == "pace" and subject.pace_per_week is None:
            raise HTTPException(status_code=400, detail=DURATION_FIELD_REQUIRED)
    else:
        if req.timeline_days is not None:
            subject.timeline_days = req.timeline_days
        if req.pace_per_week is not None:
            subject.pace_per_week = req.pace_per_week
    if req.archived is not None:
        subject.archived_at = datetime.now(timezone.utc) if req.archived else None
    db.commit()
    db.refresh(subject)
    return _subject_detail(db, subject)


@router.post(
    "/subjects/{subject_id}/lessons",
    response_model=LessonItem,
    status_code=status.HTTP_201_CREATED,
)
def add_lesson(
    subject_id: str,
    req: LessonCreateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    subject = subject_service.get_subject(db, user_id, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND)
    lesson = subject_service.add_lesson(db, subject, req.title, req.goal)
    return _lesson_item(lesson)


@router.patch("/lessons/{lesson_id}", response_model=LessonItem)
def update_lesson(
    lesson_id: str,
    req: LessonUpdateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    if req.title is None and req.goal is None and req.status is None and req.order_idx is None:
        raise HTTPException(status_code=400, detail="at least one field required")
    if req.status is not None and req.status not in ALLOWED_STATUS:
        raise HTTPException(status_code=400, detail="invalid status")
    lesson = subject_service.get_lesson(db, user_id, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail=LESSON_NOT_FOUND)
    lesson = subject_service.patch_lesson(
        db, lesson, title=req.title, goal=req.goal, status=req.status, order_idx=req.order_idx
    )
    return _lesson_item(lesson)


@router.delete("/lessons/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson(
    lesson_id: str,
    force: bool = False,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    lesson = subject_service.get_lesson(db, user_id, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail=LESSON_NOT_FOUND)
    try:
        subject_service.delete_lesson(db, lesson, force=force)
    except subject_service.LessonHasSessionError:
        raise HTTPException(status_code=409, detail=LESSON_HAS_SESSION)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/lessons/{lesson_id}/open", response_model=LessonOpenResponse)
def open_lesson(
    lesson_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    lesson = subject_service.get_lesson(db, user_id, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail=LESSON_NOT_FOUND)
    session = subject_service.open_lesson(db, user_id, lesson)
    db.refresh(lesson)
    return LessonOpenResponse(session_id=session.id, status=lesson.status)

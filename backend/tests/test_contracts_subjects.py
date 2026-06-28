"""TDD: subjects/lessons contracts are generated from openapi.yaml."""


def test_subject_contracts_import():
    from contracts import (
        DraftPlanRequest,
        DraftPlanResponse,
        LessonCreateRequest,
        LessonDraft,
        LessonItem,
        LessonOpenResponse,
        LessonUpdateRequest,
        SubjectCreateRequest,
        SubjectDetail,
        SubjectListItem,
        SubjectProgress,
        SubjectUpdateRequest,
    )

    req = SubjectCreateRequest(
        title="Organic Chemistry", per_session_minutes=30, mode="blank",
        duration_mode="deadline", timeline_days=14,
        lessons=[LessonDraft(title="Bonding", goal="learn bonds")],
    )
    assert req.mode == "blank"
    assert req.duration_mode == "deadline"
    assert req.timeline_days == 14
    assert req.pace_per_week is None
    assert req.lessons[0].title == "Bonding"

    prog = SubjectProgress(done_count=1, total_count=3)
    assert prog.total_count == 3
    open_resp = LessonOpenResponse(session_id="s1", status="in_progress")
    assert open_resp.session_id == "s1"

    draft_req = DraftPlanRequest(
        title="Organic Chemistry", per_session_minutes=30,
        duration_mode="pace", pace_per_week=3,
    )
    assert draft_req.duration_mode == "pace"
    assert draft_req.pace_per_week == 3
    assert draft_req.timeline_days is None
    draft_resp = DraftPlanResponse(lessons=[LessonDraft(title="Bonding", goal="g")])
    assert draft_resp.lessons[0].title == "Bonding"

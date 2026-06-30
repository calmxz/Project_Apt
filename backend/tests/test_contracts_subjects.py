"""TDD: subjects/lessons contracts are generated from openapi.yaml."""

import pytest
from pydantic import ValidationError


def test_subject_contracts_import():
    from contracts import (
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
        title="Organic Chemistry", per_session_minutes=30,
        duration_mode="deadline", timeline_days=14,
    )
    assert req.duration_mode == "deadline"
    assert req.timeline_days == 14
    assert req.pace_per_week is None

    # LessonDraft survives codegen (used internally by the create route/service).
    draft = LessonDraft(title="Bonding", goal="learn bonds")
    assert draft.title == "Bonding"

    prog = SubjectProgress(done_count=1, total_count=3)
    assert prog.total_count == 3
    open_resp = LessonOpenResponse(session_id="s1", status="in_progress")
    assert open_resp.session_id == "s1"


def test_subject_create_rejects_removed_fields():
    from contracts import SubjectCreateRequest

    # `mode` and `lessons` were removed; additionalProperties:false -> rejected.
    with pytest.raises(ValidationError):
        SubjectCreateRequest(
            title="X", per_session_minutes=30, duration_mode="deadline",
            timeline_days=14, mode="blank",
        )


def test_draft_plan_contracts_removed():
    import contracts

    assert not hasattr(contracts, "DraftPlanRequest")
    assert not hasattr(contracts, "DraftPlanResponse")


def test_subject_update_duration_mode_enum():
    from contracts import SubjectUpdateRequest

    req_deadline = SubjectUpdateRequest(duration_mode="deadline")
    assert req_deadline.duration_mode == "deadline"

    req_pace = SubjectUpdateRequest(duration_mode="pace")
    assert req_pace.duration_mode == "pace"

    req_none = SubjectUpdateRequest(duration_mode=None)
    assert req_none.duration_mode is None

    with pytest.raises(ValidationError):
        SubjectUpdateRequest(duration_mode="whenever")

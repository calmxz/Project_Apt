def test_contracts_drop_subject_symbols():
    import contracts
    for name in [
        "SubjectCreateRequest", "SubjectDetail", "SubjectListItem",
        "SubjectProfileResponse", "SubjectLessonRollup", "LessonItem",
        "LessonCreateRequest", "LessonUpdateRequest", "LessonDraft",
        "AddLessonSuggestion",
    ]:
        assert not hasattr(contracts, name), name


def test_session_response_has_no_subject_id():
    from contracts import SessionResponse
    assert "subject_id" not in SessionResponse.model_fields


def test_check_answer_response_has_no_suggestion():
    from contracts import CheckAnswerResponse
    assert "add_lesson_suggestion" not in CheckAnswerResponse.model_fields

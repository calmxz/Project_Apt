import pytest
from pydantic import ValidationError

from contracts import (
    AskCheckQuestionArgs,
    ChatRequest,
    ChatResponse,
    Citation,
    HealthResponse,
    PendingCheck,
    ProfileResponse,
    RecordLearningEventArgs,
    RetrieveChunksArgs,
    SessionCreateRequest,
    ToolCallRecord,
    ToolResult,
    TopicProfile,
    UpdateTopicProfileArgs,
)


def test_topic_profile_defaults():
    p = TopicProfile()
    dump = p.model_dump()
    assert dump["knowledge_level"] is None
    assert dump["confirmed_gaps"] == []
    assert dump["mastered_concepts"] == []
    assert dump["focus_target_gap"] is None
    assert dump["last_session_summary"] is None


def test_topic_profile_round_trip_json():
    raw = '{"knowledge_level":"intermediate","confirmed_gaps":["g1"],"mastered_concepts":[],"focus_target_gap":"g1","last_session_summary":null}'
    p = TopicProfile.model_validate_json(raw)
    assert p.knowledge_level == "intermediate"
    assert p.focus_target_gap == "g1"
    assert "g1" in p.model_dump_json()


def test_update_topic_profile_args_minimal_ok():
    args = UpdateTopicProfileArgs(session_id="s1", evidence_type="declared")
    assert args.session_id == "s1"
    assert args.evidence_type == "declared"
    assert args.focus_clear_reason is None


def test_update_topic_profile_args_evidence_type_optional():
    # evidence_type is now optional (required only when add_mastered_concept present
    # — enforced at the service layer, not the schema layer)
    args = UpdateTopicProfileArgs(session_id="s1")
    assert args.session_id == "s1"
    assert args.evidence_type is None


def test_update_topic_profile_args_invalid_focus_clear_reason_rejected():
    with pytest.raises(ValidationError):
        UpdateTopicProfileArgs(
            session_id="s1",
            evidence_type="declared",
            focus_clear_reason="bogus",
        )


def test_update_topic_profile_args_invalid_evidence_type_rejected():
    with pytest.raises(ValidationError):
        UpdateTopicProfileArgs(session_id="s1", evidence_type="guessed")


def test_update_topic_profile_args_extra_fields_rejected():
    with pytest.raises(ValidationError):
        UpdateTopicProfileArgs(
            session_id="s1", evidence_type="declared", surprise="x"
        )


def test_retrieve_chunks_default_k():
    args = RetrieveChunksArgs(session_id="s1", query="what is X")
    assert args.k == 5


def test_retrieve_chunks_k_bounds():
    with pytest.raises(ValidationError):
        RetrieveChunksArgs(session_id="s1", query="q", k=0)
    with pytest.raises(ValidationError):
        RetrieveChunksArgs(session_id="s1", query="q", k=21)


def test_record_learning_event_args_required():
    args = RecordLearningEventArgs(
        session_id="s1", gap_tested="g1", question="?", correct=True
    )
    assert args.correct is True
    with pytest.raises(ValidationError):
        RecordLearningEventArgs(session_id="s1", gap_tested="g1", question="?")


def test_ask_check_question_args_required_fields():
    args = AskCheckQuestionArgs(session_id="s1", gap="recursion", question="What is the base case?")
    assert args.session_id == "s1"
    assert args.gap == "recursion"
    assert args.question == "What is the base case?"


def test_ask_check_question_args_missing_gap_rejected():
    with pytest.raises(ValidationError):
        AskCheckQuestionArgs(session_id="s1", question="?")


def test_ask_check_question_args_missing_question_rejected():
    with pytest.raises(ValidationError):
        AskCheckQuestionArgs(session_id="s1", gap="recursion")


def test_ask_check_question_args_extra_fields_rejected():
    with pytest.raises(ValidationError):
        AskCheckQuestionArgs(session_id="s1", gap="g", question="?", surprise="x")


def test_pending_check_required_fields():
    pc = PendingCheck(gap="recursion", question="What is the base case?")
    assert pc.gap == "recursion"
    assert pc.question == "What is the base case?"


def test_pending_check_missing_fields_rejected():
    with pytest.raises(ValidationError):
        PendingCheck(gap="recursion")
    with pytest.raises(ValidationError):
        PendingCheck(question="?")


def test_tool_result_minimal():
    r = ToolResult(ok=True, status="ok")
    assert r.error is None
    assert r.data is None


def test_tool_result_status_enum():
    with pytest.raises(ValidationError):
        ToolResult(ok=False, status="weird")


def test_chat_response_defaults():
    r = ChatResponse(assistant_message="hi", message_id=1)
    assert r.tool_calls == []
    assert r.citations == []
    assert r.pending_check is None


def test_chat_response_with_pending_check():
    r = ChatResponse(
        assistant_message="Here is a question.",
        message_id=3,
        pending_check=PendingCheck(gap="recursion", question="What is the base case?"),
    )
    assert r.pending_check is not None
    assert r.pending_check.gap == "recursion"


def test_chat_response_with_tool_calls():
    r = ChatResponse(
        assistant_message="ok",
        message_id=2,
        tool_calls=[
            ToolCallRecord(name="update_topic_profile", args={"x": 1}, status="ok"),
            ToolCallRecord(name="retrieve_chunks", args={}, status="no_results"),
        ],
    )
    assert len(r.tool_calls) == 2
    assert r.tool_calls[1].status == "no_results"


def test_chat_request_required_fields():
    with pytest.raises(ValidationError):
        ChatRequest(session_id="s")  # missing message


def test_session_create_request_seed_mode_enum():
    SessionCreateRequest(topic="t", seed_mode="fresh")
    SessionCreateRequest(topic="t", seed_mode="resume")
    with pytest.raises(ValidationError):
        SessionCreateRequest(topic="t", seed_mode="continue")


def test_profile_response_shape():
    pr = ProfileResponse(profile=TopicProfile(), recent_learning_events=[])
    assert pr.profile.knowledge_level is None
    assert pr.recent_learning_events == []


def test_health_response():
    assert HealthResponse(status="ok").status == "ok"


def test_citation_minimal_two_arg():
    c = Citation(doc_id="d", text="t")
    assert c.doc_id == "d"
    assert c.text == "t"
    assert c.page is None
    assert c.doc_name is None


def test_citation_full_fields_round_trip():
    c = Citation(doc_id="d", text="t", page=42, doc_name="Algorithms Ch3")
    dump = c.model_dump()
    assert dump["doc_id"] == "d"
    assert dump["text"] == "t"
    assert dump["page"] == 42
    assert dump["doc_name"] == "Algorithms Ch3"


def test_citation_null_page_and_doc_name_in_dump():
    dump = Citation(doc_id="x", text="y").model_dump()
    assert "page" in dump
    assert "doc_name" in dump
    assert dump["page"] is None
    assert dump["doc_name"] is None


def test_citation_extra_fields_rejected():
    with pytest.raises(ValidationError):
        Citation(doc_id="d", text="t", surprise="x")


def test_array_fields_accept_none_quirk():
    """Codegen quirk: OpenAPI `default: []` produces `list[T] | None = []`.

    Pinned so any change is intentional. Phase 2+ consumers must treat
    these as possibly-None or normalize at the boundary.
    """
    p = TopicProfile(confirmed_gaps=None, mastered_concepts=None)
    assert p.confirmed_gaps is None
    assert p.mastered_concepts is None

    r = ChatResponse(assistant_message="x", message_id=1, tool_calls=None, citations=None)
    assert r.tool_calls is None
    assert r.citations is None

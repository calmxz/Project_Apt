"""H-3 regression: every Pydantic request/tool model must reject strings
exceeding its `max_length` cap. One parametrized case per field+cap.

Locks the caps documented in `docs/security/SECURITY_REVIEW.md` (H-3) so a
future schema regeneration that drops a cap will fail CI.
"""

import pytest
from pydantic import ValidationError

from contracts import (
    ChatRequest,
    RecordLearningEventArgs,
    RetrieveChunksArgs,
    SessionCreateRequest,
    UpdateTopicProfileArgs,
)


def _base(model):
    """Minimal valid kwargs to satisfy required fields per model.

    Phase 7: `user_id` is no longer carried in request bodies — it's resolved
    server-side from the Supabase JWT. So `_base` no longer seeds `user_id`
    for ChatRequest / SessionCreateRequest.
    """
    if model is ChatRequest:
        return {"session_id": "s", "message": "hi"}
    if model is SessionCreateRequest:
        return {"topic": "t", "seed_mode": "fresh"}
    if model is RetrieveChunksArgs:
        return {"session_id": "s", "query": "q"}
    if model is UpdateTopicProfileArgs:
        return {"session_id": "s", "evidence_type": "declared"}
    if model is RecordLearningEventArgs:
        return {
            "session_id": "s",
            "gap_tested": "g",
            "question": "q",
            "correct": True,
        }
    raise AssertionError(f"no base kwargs for {model}")


MAX_LENGTH_CASES = [
    # (Model, field, cap)
    (ChatRequest, "session_id", 64),
    (ChatRequest, "message", 4000),
    (SessionCreateRequest, "topic", 200),
    (SessionCreateRequest, "prior_session_id", 64),
    (RetrieveChunksArgs, "session_id", 64),
    (RetrieveChunksArgs, "query", 500),
    (UpdateTopicProfileArgs, "session_id", 64),
    (UpdateTopicProfileArgs, "add_confirmed_gap", 200),
    (UpdateTopicProfileArgs, "add_mastered_concept", 200),
    (UpdateTopicProfileArgs, "focus_target_gap", 200),
    (RecordLearningEventArgs, "session_id", 64),
    (RecordLearningEventArgs, "gap_tested", 200),
    (RecordLearningEventArgs, "question", 1000),
]


@pytest.mark.parametrize("model,field,cap", MAX_LENGTH_CASES)
def test_field_rejects_above_max_length(model, field, cap):
    kwargs = _base(model)
    kwargs[field] = "x" * (cap + 1)
    with pytest.raises(ValidationError) as excinfo:
        model(**kwargs)
    # The error should reference the offending field — guards against a
    # different field happening to fail validation.
    assert any(field in str(loc) for loc in (e["loc"] for e in excinfo.value.errors()))


@pytest.mark.parametrize("model,field,cap", MAX_LENGTH_CASES)
def test_field_accepts_at_max_length(model, field, cap):
    kwargs = _base(model)
    kwargs[field] = "x" * cap
    # Should not raise.
    model(**kwargs)

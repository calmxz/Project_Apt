"""LiteLLM tool definitions + dispatch router.

TOOLS exposes OpenAI-format function declarations to the LLM. dispatch()
validates incoming JSON args via the generated contract models before
routing to the corresponding service. Any exception is converted to a
ToolResult(ok=False) so the agent loop can surface it back to the LLM.
"""

from typing import Any

from agent.types import ToolContext
from contracts import (
    RecordLearningEventArgs,
    RetrieveChunksArgs,
    ToolResult,
    UpdateTopicProfileArgs,
)
from services import learning_event_service, profile_service, retrieval_service


def _schema(model) -> dict:
    s = model.model_json_schema()
    s.pop("title", None)
    return s


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "update_topic_profile",
            "description": (
                "Patch the session's TopicProfile. Use evidence_type=declared for"
                " things the user explicitly stated, tested for outcomes of"
                " record_learning_event, and inferred for observed behaviour."
                " Inferred mastery is ignored server-side."
                " To clear focus_target_gap, send it as null and provide"
                " focus_clear_reason."
            ),
            "parameters": _schema(UpdateTopicProfileArgs),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_learning_event",
            "description": (
                "Record the outcome of a check-question. Server demotes the"
                " concept from mastered_concepts automatically if correct=false."
            ),
            "parameters": _schema(RecordLearningEventArgs),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retrieve_chunks",
            "description": (
                "Vector search over the session's ingested documents."
                " Returns chunks with doc_id, text, page, score. Call this"
                " when RETRIEVAL is REQUIRED and INGESTION_STATUS is ready."
            ),
            "parameters": _schema(RetrieveChunksArgs),
        },
    },
]


def dispatch(name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    try:
        if name == "update_topic_profile":
            return profile_service.apply_patch(
                ctx.db, ctx, UpdateTopicProfileArgs.model_validate(args)
            )
        if name == "record_learning_event":
            return learning_event_service.record(
                ctx.db, ctx, RecordLearningEventArgs.model_validate(args)
            )
        if name == "retrieve_chunks":
            return retrieval_service.retrieve(
                ctx.db, ctx, RetrieveChunksArgs.model_validate(args)
            )
        return ToolResult(ok=False, status="failed", error=f"unknown tool: {name}")
    except Exception as e:
        return ToolResult(ok=False, status="failed", error=str(e))

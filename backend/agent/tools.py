"""LiteLLM tool definitions + dispatch router.

TOOLS exposes OpenAI-format function declarations to the LLM. dispatch()
validates incoming JSON args via the generated contract models before
routing to the corresponding service. Any exception is converted to a
ToolResult(ok=False) so the agent loop can surface it back to the LLM.
"""

import logging
from typing import Any

from agent.types import ToolContext
from contracts import (
    AskCheckQuestionsArgs,
    RetrieveChunksArgs,
    ToolResult,
    UpdateTopicProfileArgs,
)
from services import check_question_service, profile_service, retrieval_service

log = logging.getLogger(__name__)


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
                " things the user explicitly stated, tested for server-graded"
                " check-question outcomes, and inferred for observed behaviour."
                " Inferred mastery is ignored server-side."
                " Setting knowledge_level REQUIRES evidence_type declared or"
                " tested; without it the patch fails."
                " To clear focus_target_gap, send it as null AND provide focus_clear_reason;"
                " omitting focus_target_gap leaves focus unchanged."
                " Provide subtopic and subtopic_level together to record the"
                " learner's level on a specific subtopic (agent-named, short"
                " noun phrase; reuse existing names)."
            ),
            "parameters": _schema(UpdateTopicProfileArgs),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retrieve_chunks",
            "description": (
                "Semantic search over the documents the learner uploaded to this"
                " session. Returns up to k chunks, each with doc_id, doc_name,"
                " page, text, and score. score is a cosine distance: lower means"
                " a closer match, and results are already ordered best-first."
                " Returns status=no_results when ingestion is not ready or"
                " nothing matches; status=failed on a search error. Call it when"
                " RETRIEVAL is REQUIRED and INGESTION_STATUS is ready, or when"
                " the learner refers to their notes. Not needed when RETRIEVAL"
                " is PROVIDED: those excerpts are already in the prompt."
            ),
            "parameters": _schema(RetrieveChunksArgs),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_check_questions",
            "description": (
                "Render an interactive multiple-choice check card for one"
                " confirmed gap. items holds 1-5 questions; each has 2-4 options,"
                " a 0-based correct_index, and a one-sentence explanation shown"
                " after the learner answers. Calling it ends the turn. The server"
                " grades every answer and updates the profile; results arrive in"
                " the next turn as a [check results] user message. Only one batch"
                " can be open at a time; a second call while one is open fails."
                " Quizzes written as plain prose render no card, so this is the"
                " mechanism for any check of understanding."
            ),
            "parameters": _schema(AskCheckQuestionsArgs),
        },
    },
]


def dispatch(name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    # The LLM is never told the real session id, so it hallucinates one (e.g.
    # "session_001"). ctx.session_id is route-derived and authoritative; inject
    # it before validation so a wrong or omitted model value can never reach the
    # per-service mismatch guards.
    args = {**args, "session_id": ctx.session_id}
    try:
        if name == "update_topic_profile":
            return profile_service.apply_patch(
                ctx.db, ctx, UpdateTopicProfileArgs.model_validate(args)
            )
        if name == "retrieve_chunks":
            return retrieval_service.retrieve(
                ctx.db, ctx, RetrieveChunksArgs.model_validate(args)
            )
        if name == "ask_check_questions":
            return check_question_service.register(
                ctx.db, ctx, AskCheckQuestionsArgs.model_validate(args)
            )
        return ToolResult(ok=False, status="failed", error=f"unknown tool: {name}")
    except Exception as e:
        log.warning("tool dispatch failed name=%s error=%s", name, e)
        return ToolResult(ok=False, status="failed", error=str(e))

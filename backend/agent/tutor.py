"""Tutor agent loop. Calls LiteLLM with the three registered tools and
dispatches tool calls until the model returns a final text answer or
max_iters is exhausted.

Returns (assistant_text, list[ToolCallRecord], list[Citation]).
"""

import json
import logging

import litellm

from agent import tools
from agent._stub import stub_response
from agent.types import ToolContext
from config import settings
from contracts import Citation, ToolCallRecord


log = logging.getLogger(__name__)

MAX_ITERS = 8
FALLBACK_TEXT = "I'm having trouble finishing that — could you rephrase?"


def _serialize_tool_calls(tool_calls) -> list[dict] | None:
    if not tool_calls:
        return None
    out: list[dict] = []
    for tc in tool_calls:
        out.append(
            {
                "id": getattr(tc, "id", None),
                "type": getattr(tc, "type", "function"),
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
        )
    return out


async def run(
    messages: list[dict],
    system_prompt: str,
    ctx: ToolContext,
    max_iters: int = MAX_ITERS,
) -> tuple[str, list[ToolCallRecord], list[Citation]]:
    if settings.llm_stub_enabled:
        return (stub_response(messages, system_prompt), [], [])

    full: list[dict] = [{"role": "system", "content": system_prompt}] + list(messages)
    tool_calls_record: list[ToolCallRecord] = []
    citations: list[Citation] = []

    for _ in range(max_iters):
        resp = await litellm.acompletion(
            model=settings.model,
            messages=full,
            tools=tools.TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message
        msg_tool_calls = getattr(msg, "tool_calls", None)

        full.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": _serialize_tool_calls(msg_tool_calls),
            }
        )

        if not msg_tool_calls:
            return (msg.content or "", tool_calls_record, citations)

        for tc in msg_tool_calls:
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError as e:
                args = {}
                log.warning("invalid tool args json: %s", e)

            result = tools.dispatch(tc.function.name, args, ctx)
            tool_calls_record.append(
                ToolCallRecord(
                    name=tc.function.name,
                    args=args,
                    status=result.status,
                    error=result.error,
                )
            )

            if tc.function.name == "retrieve_chunks" and result.ok:
                raw_chunks = (result.data or {}).get("chunks", [])
                for ch in raw_chunks:
                    citations.append(
                        Citation(doc_id=str(ch.get("doc_id", "")), text=ch.get("text", ""))
                    )
                wrapped_chunks = [
                    {
                        **ch,
                        "text": (
                            f"<document_excerpt id={str(ch.get('doc_id', ''))!r}>"
                            f"{ch.get('text', '')}"
                            f"</document_excerpt>"
                        ),
                    }
                    for ch in raw_chunks
                ]
                tool_payload = result.model_copy(
                    update={"data": {**(result.data or {}), "chunks": wrapped_chunks}}
                )
                tool_content = json.dumps(tool_payload.model_dump())
            else:
                tool_content = json.dumps(result.model_dump())

            full.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tc.function.name,
                    "content": tool_content,
                }
            )

    return (FALLBACK_TEXT, tool_calls_record, citations)

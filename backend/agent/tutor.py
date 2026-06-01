"""Tutor agent loop. Calls LiteLLM with the three registered tools and
dispatches tool calls until the model returns a final text answer or
max_iters is exhausted.

Returns (assistant_text, list[ToolCallRecord], list[Citation]).
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import AsyncIterator

import litellm

from agent import tools
from agent._stub import stub_response
from agent.stream_events import StreamEvent
from agent.types import ToolContext
from config import settings
from contracts import Citation, ToolCallRecord
from db.models import ChatMessage
from services import cost_meter


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

    for i in range(max_iters):
        if i > 0:
            cap = cost_meter.check_cap(ctx.db, ctx.user_id)
            if not cap.allowed:
                log.warning(
                    "hard cost cap reached mid-turn for user_id=%s used=%s",
                    ctx.user_id, cap.used,
                )
                return (FALLBACK_TEXT, tool_calls_record, citations)

        resp = await litellm.acompletion(
            model=settings.model,
            messages=full,
            tools=tools.TOOLS,
            tool_choice="auto",
        )

        try:
            call_cost = litellm.completion_cost(completion_response=resp) or 0.0
        except Exception as e:
            log.warning("completion_cost failed: %s", e)
            call_cost = 0.0
        if call_cost > 0:
            try:
                cost_meter.record_cost(ctx.db, ctx.user_id, call_cost)
            except Exception as e:
                log.warning("cost_meter.record_cost failed: %s", e)

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

        asked_check = False
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

            if tc.function.name == "ask_check_question" and result.ok:
                asked_check = True

            if tc.function.name == "retrieve_chunks" and result.ok:
                raw_chunks = (result.data or {}).get("chunks", [])
                for ch in raw_chunks:
                    citations.append(
                        Citation(
                            doc_id=str(ch.get("doc_id", "")),
                            text=ch.get("text", ""),
                            page=ch.get("page"),
                            doc_name=ch.get("doc_name"),
                        )
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

        if asked_check:
            # Turn-terminating: the check question has been handed to the learner.
            # Grading happens on the next turn, not this one.
            return (msg.content or "", tool_calls_record, citations)

    return (FALLBACK_TEXT, tool_calls_record, citations)


# ---------------------------------------------------------------------------
# Streaming variant
# ---------------------------------------------------------------------------


def _persist_assistant_message(
    ctx, content, status, cancelled_at=None, tool_calls=None, citations=None
):
    # run_streaming OWNS persistence of the streaming assistant message on BOTH
    # normal completion and cancel. This differs from non-streaming run(), whose
    # caller (the chat route) persists the message: a cancelled stream cannot be
    # persisted from the route after the client disconnects, so the agent does it.
    # tool_calls_json / citations_json are serialized here with the same shape the
    # chat route uses for run(), so a resumed session renders streamed messages
    # (including partial ones on cancel) with their tool calls and citations.
    m = ChatMessage(
        session_id=ctx.session_id,
        role="assistant",
        content=content,
        status=status,
        cancelled_at=cancelled_at,
        tool_calls_json=json.dumps([tc.model_dump() for tc in (tool_calls or [])]),
        citations_json=json.dumps([c.model_dump() for c in (citations or [])]),
    )
    ctx.db.add(m)
    ctx.db.commit()
    return m.id


def _summarize(name: str, result) -> str:
    if name == "retrieve_chunks":
        return f"Found {len((result.data or {}).get('chunks', []))} passages"
    if name == "update_topic_profile":
        return "Profile updated"
    if name == "record_learning_event":
        return "Answer recorded"
    if name == "ask_check_question":
        return "Question asked"
    return "ok"


def _chunk_text(text: str, parts: int = 3) -> list[str]:
    """Split text into ~`parts` word-boundary chunks for stub streaming."""
    words = text.split(" ")
    if len(words) <= 1:
        return [text]
    parts = max(1, min(parts, len(words)))
    size = -(-len(words) // parts)  # ceil division
    out: list[str] = []
    for i in range(0, len(words), size):
        group = words[i : i + size]
        sep = " " if (i + size) < len(words) else ""
        out.append(" ".join(group) + sep)
    return out


async def run_streaming(
    messages: list[dict],
    system_prompt: str,
    ctx: ToolContext,
    max_iters: int = MAX_ITERS,
) -> AsyncIterator[StreamEvent]:
    """Streaming mirror of run(). Yields StreamEvent objects live.

    Real token streaming via litellm.acompletion(stream=True) each iteration.
    Owns persistence of the assistant ChatMessage (complete or cancelled) and
    records an estimated cost on cancellation.
    """
    # Stub mode: deterministic, no LLM, no tools, no cost. Chunked so the UI
    # still exercises the delta path.
    if settings.llm_stub_enabled:
        text = stub_response(messages, system_prompt)
        accumulated_text = ""
        for piece in _chunk_text(text):
            accumulated_text += piece
            yield StreamEvent("assistant_delta", {"text": piece})
        msg_id = _persist_assistant_message(ctx, accumulated_text, "complete")
        yield StreamEvent("done", {"message_id": str(msg_id)})
        return

    full: list[dict] = [{"role": "system", "content": system_prompt}] + list(messages)
    accumulated_text = ""
    prompt_tokens_total = 0
    tool_calls_record: list[ToolCallRecord] = []
    citations: list[Citation] = []

    try:
        for _i in range(max_iters):
            cap = cost_meter.check_cap(ctx.db, ctx.user_id)
            if not cap.allowed:
                log.warning(
                    "hard cost cap reached mid-turn (stream) for user_id=%s used=%s",
                    ctx.user_id, cap.used,
                )
                yield StreamEvent(
                    "error",
                    {
                        "code": "daily_cost_cap_reached",
                        "used_usd": str(cap.used),
                        "soft_cap_usd": str(cap.soft_cap),
                        "hard_cap_usd": str(cap.hard_cap),
                    },
                )
                return

            try:
                prompt_tokens_total += litellm.token_counter(
                    model=settings.model, messages=full
                )
            except Exception as e:
                # litellm.token_counter is local tokenization (no API call); the
                # exception carries no credential. The rule trips on "token" in
                # the message, not on any logged secret.
                log.warning("token_counter failed: %s", e)  # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure

            resp = await litellm.acompletion(
                model=settings.model,
                messages=full,
                tools=tools.TOOLS,
                tool_choice="auto",
                stream=True,
            )

            content_buf = ""
            tool_frags: dict[int, dict] = {}
            chunks: list = []

            async for chunk in resp:
                chunks.append(chunk)
                delta = chunk.choices[0].delta

                token = getattr(delta, "content", None)
                if token:
                    content_buf += token
                    accumulated_text += token
                    yield StreamEvent("assistant_delta", {"text": token})

                tcs = getattr(delta, "tool_calls", None)
                if tcs:
                    for tcd in tcs:
                        idx = getattr(tcd, "index", 0)
                        slot = tool_frags.setdefault(
                            idx, {"id": None, "name": None, "args": ""}
                        )
                        tcd_id = getattr(tcd, "id", None)
                        if tcd_id:
                            slot["id"] = tcd_id
                        fn = getattr(tcd, "function", None)
                        if fn is not None:
                            fn_name = getattr(fn, "name", None)
                            if fn_name:
                                slot["name"] = fn_name
                            fn_args = getattr(fn, "arguments", None)
                            if fn_args:
                                slot["args"] += fn_args

            # Record this iteration's cost BEFORE branching on tool_frags. Every
            # acompletion above is billed, so tool-dispatch iterations must count
            # toward the daily cap too (mirrors non-streaming run(), which records
            # each iteration). Previously this block lived inside `if not
            # tool_frags`, so multi-tool turns charged only their final text
            # iteration and could evade the hard cost cap.
            try:
                built = litellm.stream_chunk_builder(chunks, messages=full)
                cost = litellm.completion_cost(completion_response=built) or 0.0
            except Exception as e:
                log.warning("stream completion_cost failed: %s", e)
                cost = 0.0
            if cost > 0:
                try:
                    cost_meter.record_cost(ctx.db, ctx.user_id, cost)
                except Exception as e:
                    log.warning("cost_meter.record_cost failed: %s", e)

            # No tool calls assembled -> the streamed content was the final answer.
            if not tool_frags:
                # Soft-cap warning: the non-streaming /chat path sets an
                # X-Cost-Warning header after metering, but SSE flushes its
                # headers before the LLM runs, so the streaming path emits the
                # 90%-of-cap signal as a dedicated event instead. Routed through
                # the same costBus -> toast as the header path on the client.
                post = cost_meter.check_cap(ctx.db, ctx.user_id)
                if post.soft_breached:
                    yield StreamEvent(
                        "cost_warning",
                        {
                            "used_usd": str(post.used),
                            "soft_cap_usd": str(post.soft_cap),
                            "hard_cap_usd": str(post.hard_cap),
                        },
                    )
                msg_id = _persist_assistant_message(
                    ctx,
                    accumulated_text,
                    "complete",
                    tool_calls=tool_calls_record,
                    citations=citations,
                )
                yield StreamEvent("done", {"message_id": str(msg_id)})
                return

            # Tool calls present: append the assistant turn, then dispatch each.
            ordered = [tool_frags[k] for k in sorted(tool_frags)]
            full.append(
                {
                    "role": "assistant",
                    "content": content_buf or None,
                    "tool_calls": [
                        {
                            "id": slot["id"],
                            "type": "function",
                            "function": {
                                "name": slot["name"],
                                "arguments": slot["args"],
                            },
                        }
                        for slot in ordered
                    ],
                }
            )

            asked_check = False
            for slot in ordered:
                name = slot["name"]
                call_id = slot["id"]

                try:
                    args = json.loads(slot["args"]) if slot["args"] else {}
                except json.JSONDecodeError as e:
                    args = {}
                    log.warning("invalid tool args json (stream): %s", e)

                yield StreamEvent(
                    "tool_call_start",
                    {"id": call_id, "name": name, "args": args},
                )

                result = tools.dispatch(name, args, ctx)
                tool_calls_record.append(
                    ToolCallRecord(
                        name=name, args=args, status=result.status, error=result.error
                    )
                )

                if result.ok:
                    yield StreamEvent(
                        "tool_call_done",
                        {"id": call_id, "status": "ok", "summary": _summarize(name, result)},
                    )
                else:
                    yield StreamEvent(
                        "tool_call_done",
                        {"id": call_id, "status": "error", "error": result.error},
                    )

                if name == "ask_check_question" and result.ok:
                    data = result.data or {}
                    yield StreamEvent(
                        "check_question",
                        {"gap": data.get("gap"), "question": data.get("question")},
                    )
                    asked_check = True

                if name == "record_learning_event" and result.ok:
                    data = result.data or {}
                    yield StreamEvent(
                        "check_result",
                        {"gap": args.get("gap_tested"), "correct": data.get("correct")},
                    )

                if name == "retrieve_chunks" and result.ok:
                    raw_chunks = (result.data or {}).get("chunks", [])
                    new_cites = [
                        Citation(
                            doc_id=str(ch.get("doc_id", "")),
                            text=ch.get("text", ""),
                            page=ch.get("page"),
                            doc_name=ch.get("doc_name"),
                        )
                        for ch in raw_chunks
                    ]
                    citations.extend(new_cites)
                    if new_cites:
                        yield StreamEvent(
                            "citations", [c.model_dump() for c in new_cites]
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
                        "tool_call_id": call_id,
                        "name": name,
                        "content": tool_content,
                    }
                )

            if asked_check:
                # Turn-terminating: check question handed to learner. Persist and
                # stop. Grading happens on the next turn, not this one.
                # Cost for this LLM call was already recorded above (before the
                # tool-dispatch section), so no extra metering needed here.
                msg_id = _persist_assistant_message(
                    ctx,
                    accumulated_text,
                    "complete",
                    tool_calls=tool_calls_record,
                    citations=citations,
                )
                yield StreamEvent("done", {"message_id": str(msg_id)})
                return

        # max_iters exhausted without a final answer.
        yield StreamEvent("error", {"code": "max_iters_reached"})
        return

    except asyncio.CancelledError:
        try:
            cost = cost_meter.estimate_cancelled_cost(
                settings.model, accumulated_text, prompt_tokens_total
            )
        except Exception as e:
            log.warning("estimate_cancelled_cost failed: %s", e)
            cost = Decimal("0")
        try:
            cost_meter.record_cost(ctx.db, ctx.user_id, cost)
        except Exception as e:
            log.warning("cost_meter.record_cost (cancel) failed: %s", e)

        msg_id = _persist_assistant_message(
            ctx,
            accumulated_text,
            "cancelled",
            cancelled_at=datetime.now(timezone.utc),
            tool_calls=tool_calls_record,
            citations=citations,
        )
        yield StreamEvent(
            "cancelled",
            {
                "message_id": str(msg_id),
                "partial_content_chars": len(accumulated_text),
                "estimated_cost_usd": str(cost),
            },
        )
        raise

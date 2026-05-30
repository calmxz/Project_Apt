"""Tests for the streaming tutor agent loop (tutor.run_streaming).

run_streaming mirrors run() but yields StreamEvent objects live, calls
litellm.acompletion(stream=True) each iteration, owns persistence of the
assistant ChatMessage (on both normal completion and cancel), and records
an estimated cost on cancellation.

Streaming mock shape (mirrors litellm streaming objects):
  await litellm.acompletion(stream=True) resolves to an async iterator of
  chunk objects. Each chunk: chunk.choices[0].delta with
    - .content : token string or None
    - .tool_calls : None or [fragment, ...] where each fragment has
        .index, .id, .function.name, .function.arguments
  Fragments arrive piecemeal: id + function.name set once (when present),
  function.arguments concatenated across fragments.
"""

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.types import ToolContext
from config import settings
from contracts import ToolResult
from db.models import ChatMessage
from services.cost_meter import CapStatus


# ---------------------------------------------------------------------------
# Streaming chunk builders
# ---------------------------------------------------------------------------

def _content_chunk(token: str) -> SimpleNamespace:
    """A streamed chunk carrying a content token and no tool calls."""
    delta = SimpleNamespace(content=token, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def _tool_fragment(index, *, id=None, name=None, arguments=None) -> SimpleNamespace:
    """A single tool-call delta fragment.

    `name` is assigned AFTER construction because MagicMock(name=...) is
    reserved and would NOT set a real .name attribute. We use SimpleNamespace
    here which has no such restriction, but build the .function with an
    explicit name attr to mirror the real shape.
    """
    fn = SimpleNamespace()
    fn.name = name
    fn.arguments = arguments
    frag = SimpleNamespace()
    frag.index = index
    frag.id = id
    frag.function = fn
    return frag


def _tool_chunk(*fragments) -> SimpleNamespace:
    """A streamed chunk carrying tool-call fragments and no content."""
    delta = SimpleNamespace(content=None, tool_calls=list(fragments))
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def _make_stream(*chunks):
    """Return a fresh async-generator instance yielding the given chunks."""
    async def _gen():
        for c in chunks:
            yield c
    return _gen()


def _ctx(db_session, session_id="s1"):
    return ToolContext(
        db=db_session,
        session_id=session_id,
        user_id="u1",
        turn_started_at=datetime.now(timezone.utc),
    )


def _disable_stub(monkeypatch):
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real-key")


def _allow_cap(monkeypatch):
    cap = CapStatus(
        allowed=True,
        used=Decimal("0.0"),
        soft_breached=False,
        soft_cap=Decimal("2.0"),
        hard_cap=Decimal("3.0"),
    )
    monkeypatch.setattr("agent.tutor.cost_meter.check_cap", MagicMock(return_value=cap))


async def _drain(agen):
    return [ev async for ev in agen]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_streaming_yields_tool_then_delta_then_done(db_session, monkeypatch):
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    # Turn 1: a retrieve_chunks tool call assembled from two fragments.
    turn1 = _make_stream(
        _tool_chunk(_tool_fragment(0, id="tc_1", name="retrieve_chunks", arguments='{"query":')),
        _tool_chunk(_tool_fragment(0, arguments='"photosynthesis"}')),
    )
    # Turn 2: two content tokens forming the final answer.
    turn2 = _make_stream(_content_chunk("Hello "), _content_chunk("world"))

    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=[turn1, turn2]),
    )

    result = ToolResult(
        ok=True,
        status="ok",
        error=None,
        data={"chunks": [{"doc_id": "d1", "text": "leaves convert light"}]},
    )
    monkeypatch.setattr("agent.tutor.tools.dispatch", MagicMock(return_value=result))

    ctx = _ctx(db_session, session_id="s1")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "explain"}], "sys", ctx)
    )

    types = [e.type for e in events]
    assert "tool_call_start" in types
    assert "tool_call_done" in types
    assert "citations" in types
    assert types.count("assistant_delta") == 2
    assert types[-1] == "done"

    deltas = [e.data["text"] for e in events if e.type == "assistant_delta"]
    assert deltas == ["Hello ", "world"]

    start = next(e for e in events if e.type == "tool_call_start")
    assert start.data["name"] == "retrieve_chunks"
    assert start.data["args"] == {"query": "photosynthesis"}

    cites = next(e for e in events if e.type == "citations")
    assert cites.data == [
        {"doc_id": "d1", "text": "leaves convert light", "page": None, "doc_name": None}
    ]

    # Persisted assistant message.
    msg = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.session_id == "s1")
        .one()
    )
    assert msg.status == "complete"
    assert msg.content == "Hello world"
    assert msg.role == "assistant"

    # Parity with non-streaming run(): the persisted row carries the tool calls
    # and citations so a resumed session renders them (agent owns persistence).
    assert json.loads(msg.citations_json) == [
        {"doc_id": "d1", "text": "leaves convert light", "page": None, "doc_name": None}
    ]
    persisted_tcs = json.loads(msg.tool_calls_json)
    assert len(persisted_tcs) == 1
    assert persisted_tcs[0]["name"] == "retrieve_chunks"
    assert persisted_tcs[0]["status"] == "ok"


@pytest.mark.asyncio
async def test_run_streaming_persists_cancelled_on_cancel(db_session, monkeypatch):
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    async def _slow_stream():
        yield _content_chunk("partial ")
        await asyncio.sleep(10)

    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=[_slow_stream()]),
    )

    ctx = _ctx(db_session, session_id="s2")

    received = []

    async def _consume():
        async for ev in tutor.run_streaming(
            [{"role": "user", "content": "go"}], "sys", ctx
        ):
            received.append(ev)

    task = asyncio.create_task(_consume())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    msg = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.session_id == "s2")
        .one()
    )
    assert msg.status == "cancelled"
    assert "partial" in msg.content
    assert msg.cancelled_at is not None

    assert any(e.type == "cancelled" for e in received)


@pytest.mark.asyncio
async def test_run_streaming_emits_error_on_cost_cap(db_session, monkeypatch):
    _disable_stub(monkeypatch)

    from agent import tutor

    cap = CapStatus(
        allowed=False,
        used=Decimal("3.10"),
        soft_breached=True,
        soft_cap=Decimal("2.0"),
        hard_cap=Decimal("3.0"),
    )
    monkeypatch.setattr("agent.tutor.cost_meter.check_cap", MagicMock(return_value=cap))

    # acompletion must never be reached; if it is, this raises.
    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=AssertionError("acompletion called after cap")),
    )

    ctx = _ctx(db_session, session_id="s3")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx)
    )

    assert events[-1].type == "error"
    assert events[-1].data["code"] == "daily_cost_cap_reached"


@pytest.mark.asyncio
async def test_run_streaming_emits_cost_warning_when_soft_breached(db_session, monkeypatch):
    """When the cost soft cap (90%) is breached after the final iteration, the
    stream emits a `cost_warning` event before `done` -- parity with the
    non-streaming X-Cost-Warning header path (which SSE cannot use, since its
    headers flush before the LLM runs and the spend is known).
    """
    _disable_stub(monkeypatch)

    cap = CapStatus(
        allowed=True,
        used=Decimal("1.95"),
        soft_breached=True,
        soft_cap=Decimal("2.0"),
        hard_cap=Decimal("3.0"),
    )
    monkeypatch.setattr("agent.tutor.cost_meter.check_cap", MagicMock(return_value=cap))

    from agent import tutor

    turn = _make_stream(_content_chunk("final answer"))
    monkeypatch.setattr("agent.tutor.litellm.acompletion", AsyncMock(side_effect=[turn]))
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.01))
    monkeypatch.setattr("agent.tutor.cost_meter.record_cost", MagicMock())

    ctx = _ctx(db_session, session_id="s_softcap")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx)
    )

    types = [e.type for e in events]
    assert "cost_warning" in types
    assert types.index("cost_warning") < types.index("done")
    assert types[-1] == "done"

    cw = next(e for e in events if e.type == "cost_warning")
    assert cw.data == {"used_usd": "1.95", "soft_cap_usd": "2.0", "hard_cap_usd": "3.0"}


@pytest.mark.asyncio
async def test_run_streaming_no_cost_warning_when_under_soft_cap(db_session, monkeypatch):
    """No cost_warning when the soft cap is not breached (default happy path)."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    turn = _make_stream(_content_chunk("ok"))
    monkeypatch.setattr("agent.tutor.litellm.acompletion", AsyncMock(side_effect=[turn]))
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.0))
    monkeypatch.setattr("agent.tutor.cost_meter.record_cost", MagicMock())

    ctx = _ctx(db_session, session_id="s_nosoft")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx)
    )

    assert "cost_warning" not in [e.type for e in events]
    assert events[-1].type == "done"


@pytest.mark.asyncio
async def test_run_streaming_stub_mode_chunks(db_session, monkeypatch):
    from agent import tutor
    from agent._stub import stub_response

    monkeypatch.setattr(settings, "llm_stub", True)

    messages = [{"role": "user", "content": "hello there friend"}]
    ctx = _ctx(db_session, session_id="s4")
    events = await _drain(tutor.run_streaming(messages, "sys", ctx))

    deltas = [e for e in events if e.type == "assistant_delta"]
    assert len(deltas) >= 1
    assert events[-1].type == "done"

    joined = "".join(e.data["text"] for e in deltas)
    assert joined == stub_response(messages, "sys")

    msg = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.session_id == "s4")
        .one()
    )
    assert msg.status == "complete"
    assert msg.content == stub_response(messages, "sys")


@pytest.mark.asyncio
async def test_run_streaming_records_cost_on_tool_iterations(db_session, monkeypatch):
    """Regression (review #1): cost must be recorded on EVERY billed iteration,
    including tool-dispatch iterations -- not only on the final text iteration.

    A two-iteration turn (turn 1 assembles a tool call, turn 2 returns the final
    answer) issues two billed acompletion calls, so record_cost must fire twice.
    The pre-fix code recorded cost only inside the `not tool_frags` branch, so it
    fired once and tool-heavy turns could evade the daily cost cap.
    """
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    turn1 = _make_stream(
        _tool_chunk(
            _tool_fragment(0, id="tc_1", name="retrieve_chunks", arguments='{"query":"x"}')
        ),
    )
    turn2 = _make_stream(_content_chunk("done"))
    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=[turn1, turn2]),
    )

    monkeypatch.setattr(
        "agent.tutor.tools.dispatch",
        MagicMock(return_value=ToolResult(ok=True, status="ok", error=None, data={"chunks": []})),
    )

    # completion_cost / stream_chunk_builder would choke on the SimpleNamespace
    # fakes, so pin them; we only care that record_cost is invoked per iteration.
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder",
        MagicMock(return_value=SimpleNamespace()),
    )
    monkeypatch.setattr(
        "agent.tutor.litellm.completion_cost",
        MagicMock(return_value=0.01),
    )
    record = MagicMock()
    monkeypatch.setattr("agent.tutor.cost_meter.record_cost", record)

    ctx = _ctx(db_session, session_id="s_cost_iter")
    await _drain(tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx))

    assert record.call_count == 2
    assert [c.args[2] for c in record.call_args_list] == [0.01, 0.01]

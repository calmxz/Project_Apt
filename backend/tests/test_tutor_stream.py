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
import copy
import json
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.types import ToolContext
from config import settings
from contracts import ToolResult
from db.models import ChatMessage, LlmCallLog
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
        urgent_breached=False,
        soft_cap=Decimal("2.0"),
        urgent_cap=Decimal("2.70"),
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
async def test_no_token_counter_on_happy_path(db_session, monkeypatch):
    """P3.2: litellm.token_counter is billing-estimate overhead needed only if
    the stream is cancelled mid-flight. A normal (non-cancelled) turn must do
    zero tokenization."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    calls = []

    def _counter(*a, **k):
        calls.append(1)
        return 100

    monkeypatch.setattr("agent.tutor.litellm.token_counter", _counter)

    turn = _make_stream(_content_chunk("final answer"))
    monkeypatch.setattr("agent.tutor.litellm.acompletion", AsyncMock(side_effect=[turn]))
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.0032))

    ctx = _ctx(db_session, session_id="s_no_token_counter")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx)
    )

    assert events[-1].type == "done"
    assert calls == []


@pytest.mark.asyncio
async def test_cancelled_stream_estimates_tokens_lazily(db_session, monkeypatch):
    """P3.2: on cancellation, tokenization happens lazily from the recorded
    iter_prompt_snapshots -- token_counter is called during cancellation
    handling (not per-iteration on the happy path), and the resulting positive
    prompt_tokens_total is what gets passed to estimate_cancelled_cost."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    counter_calls = []

    def _counter(*a, **k):
        counter_calls.append(1)
        return 100

    monkeypatch.setattr("agent.tutor.litellm.token_counter", _counter)

    estimate_spy = MagicMock(return_value=Decimal("0.01"))
    monkeypatch.setattr("agent.tutor.cost_meter.estimate_cancelled_cost", estimate_spy)

    async def _slow_stream():
        yield _content_chunk("partial ")
        await asyncio.sleep(10)

    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=[_slow_stream()]),
    )

    ctx = _ctx(db_session, session_id="s_cancel_tokens")

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

    assert counter_calls, "token_counter must be called during cancellation handling"
    assert estimate_spy.call_count == 1
    prompt_tokens_total = estimate_spy.call_args.args[2]
    assert prompt_tokens_total > 0


@pytest.mark.asyncio
async def test_run_streaming_emits_error_on_cost_cap(db_session, monkeypatch):
    _disable_stub(monkeypatch)

    from agent import tutor

    cap = CapStatus(
        allowed=False,
        used=Decimal("3.10"),
        soft_breached=True,
        urgent_breached=True,
        soft_cap=Decimal("2.0"),
        urgent_cap=Decimal("2.70"),
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
        urgent_breached=False,
        soft_cap=Decimal("2.0"),
        urgent_cap=Decimal("2.70"),
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
    assert cw.data == {
        "level": "soft",
        "used_usd": "1.95",
        "soft_cap_usd": "2.0",
        "urgent_cap_usd": "2.70",
        "hard_cap_usd": "3.0",
    }


@pytest.mark.asyncio
async def test_run_streaming_cost_warning_marks_urgent_level(db_session, monkeypatch):
    """When spend is in the urgent band (>= urgent_cap), the cost_warning
    event's level must be "urgent" instead of "soft"."""
    _disable_stub(monkeypatch)

    cap = CapStatus(
        allowed=True,
        used=Decimal("2.80"),
        soft_breached=True,
        urgent_breached=True,
        soft_cap=Decimal("2.0"),
        urgent_cap=Decimal("2.70"),
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

    ctx = _ctx(db_session, session_id="s_urgentcap")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx)
    )

    cw = next(e for e in events if e.type == "cost_warning")
    assert cw.data["level"] == "urgent"


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


@pytest.mark.asyncio
async def test_run_streaming_ask_check_question_skips_siblings(db_session, monkeypatch):
    """ask_check_questions is turn-terminating: a sibling tool call streamed in the
    same response (e.g. a premature self-grade) must NOT be dispatched, so no
    spurious 'Recording failed' chip is emitted."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    turn1 = _make_stream(
        _tool_chunk(
            _tool_fragment(
                0,
                id="tc_0",
                name="record_learning_event",
                arguments='{"session_id":"s1","gap_tested":"x","question":"q?","correct":true}',
            ),
            _tool_fragment(
                1,
                id="tc_1",
                name="ask_check_questions",
                arguments=json.dumps({
                    "session_id": "s1", "gap": "x",
                    "items": [{"question": "What is x?", "options": ["yes", "no"],
                               "correct_index": 0, "explanation": "Yes."}],
                }),
            ),
        ),
    )
    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion", AsyncMock(side_effect=[turn1])
    )
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.0))
    dispatch = MagicMock(
        return_value=ToolResult(
            ok=True, status="ok", error=None,
            data={"gap": "x", "total": 1, "items": [{"question": "What is x?", "options": ["yes", "no"]}]},
        )
    )
    monkeypatch.setattr("agent.tutor.tools.dispatch", dispatch)

    ctx = _ctx(db_session, session_id="s_ask_skip")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "quiz me"}], "sys", ctx)
    )

    # Only ask_check_questions reached dispatch; the premature grade was dropped.
    dispatched = [c.args[0] for c in dispatch.call_args_list]
    assert dispatched == ["ask_check_questions"]

    types = [e.type for e in events]
    assert "check_question" in types
    assert types[-1] == "done"


@pytest.mark.asyncio
async def test_stream_logs_token_usage(db_session, monkeypatch):
    """log_call receives the token usage extracted from stream_chunk_builder's
    output (extract_usage, Task 3) so llm_call_log rows carry token counts."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    built = SimpleNamespace(usage=SimpleNamespace(
        prompt_tokens=1500, completion_tokens=200,
        prompt_tokens_details=SimpleNamespace(cached_tokens=1100),
    ))
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=built)
    )
    monkeypatch.setattr(
        "agent.tutor.litellm.completion_cost", MagicMock(return_value=0.01)
    )
    log_call_spy = MagicMock()
    monkeypatch.setattr("agent.tutor.cost_meter.log_call", log_call_spy)

    turn = _make_stream(_content_chunk("final answer"))
    monkeypatch.setattr("agent.tutor.litellm.acompletion", AsyncMock(side_effect=[turn]))

    ctx = _ctx(db_session, session_id="s_token_usage")
    await _drain(tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx))

    assert log_call_spy.call_count == 1
    kwargs = log_call_spy.call_args.kwargs
    assert kwargs["prompt_tokens"] == 1500
    assert kwargs["completion_tokens"] == 200
    assert kwargs["cached_tokens"] == 1100


@pytest.mark.asyncio
async def test_run_streaming_writes_llm_call_log_row(db_session, monkeypatch):
    """Integration: log_call is additive to record_cost, not a replacement.
    After a streamed turn with nonzero cost, LlmCallLog gains a row with
    purpose == "chat" (suppress_check is unset, so it is not "followup")."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    turn = _make_stream(_content_chunk("hi there"))
    monkeypatch.setattr("agent.tutor.litellm.acompletion", AsyncMock(side_effect=[turn]))
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.0032))

    ctx = _ctx(db_session, session_id="s_call_log")
    await _drain(tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx))

    row = db_session.query(LlmCallLog).filter(LlmCallLog.session_id == "s_call_log").one()
    assert row.purpose == "chat"
    assert row.user_id == "u1"


@pytest.mark.asyncio
async def test_llm_exception_yields_error_event_and_persists_partial(db_session, monkeypatch):
    """F-01: a non-cancel exception (provider 429/timeout, malformed chunk, tool
    crash) must surface as exactly one error SSE event -- not escape the
    generator and leave the client stuck in 'streaming' forever -- and the
    partial assistant text must be persisted with status='error'."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    async def exploding_acompletion(**kwargs):
        raise RuntimeError("provider blew up")

    monkeypatch.setattr("agent.tutor.litellm.acompletion", exploding_acompletion)

    ctx = _ctx(db_session, session_id="s_llm_exception")
    events = await _drain(
        tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx)
    )

    error_events = [e for e in events if e.type == "error"]
    assert len(error_events) == 1
    assert error_events[0].data["code"] == "llm_failed"

    msg = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.session_id == "s_llm_exception")
        .one()
    )
    assert msg.status == "error"


@pytest.mark.asyncio
async def test_prune_superseded_excerpts_wired_into_loop(db_session, monkeypatch):
    """Integration (Task 7): prune_superseded_excerpts runs after each
    tool-dispatch iteration. Two same-turn retrieve_chunks calls (iterations 1
    and 2) followed by a final text iteration (3) must arrive at the third
    acompletion call with the FIRST retrieval's tool message stubbed and the
    SECOND (newest) retrieval's document_excerpt intact.

    `full` is mutated and reused across iterations, so the fake acompletion
    must deep-copy kwargs["messages"] at call time -- a plain reference would
    show the same (fully mutated) list for every captured call.
    """
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    turn1 = _make_stream(
        _tool_chunk(_tool_fragment(0, id="tc_1", name="retrieve_chunks", arguments='{"query":"a"}')),
    )
    turn2 = _make_stream(
        _tool_chunk(_tool_fragment(0, id="tc_2", name="retrieve_chunks", arguments='{"query":"b"}')),
    )
    turn3 = _make_stream(_content_chunk("final answer"))
    turns = [turn1, turn2, turn3]

    captured_messages = []

    async def _fake_acompletion(*args, **kwargs):
        captured_messages.append(copy.deepcopy(kwargs["messages"]))
        return turns.pop(0)

    monkeypatch.setattr("agent.tutor.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.0))

    def _dispatch(name, args, ctx):
        first = args.get("query") == "a"
        chunk = {
            "doc_id": "d1" if first else "d2",
            "doc_name": "notes.pdf" if first else "slides.pdf",
            "text": "old material" if first else "new material",
        }
        return ToolResult(ok=True, status="ok", error=None, data={"chunks": [chunk]})

    monkeypatch.setattr("agent.tutor.tools.dispatch", MagicMock(side_effect=_dispatch))

    ctx = _ctx(db_session, session_id="s_prune")
    await _drain(tutor.run_streaming([{"role": "user", "content": "hi"}], "sys", ctx))

    assert len(captured_messages) == 3
    third_call_msgs = captured_messages[2]
    tool_msgs = [m for m in third_call_msgs if m.get("role") == "tool" and m.get("name") == "retrieve_chunks"]
    assert len(tool_msgs) == 2
    assert tool_msgs[0]["content"].startswith("[superseded retrieval:")
    assert "<document_excerpt" in tool_msgs[1]["content"]


@pytest.mark.asyncio
async def test_cancelled_stream_prompt_tokens_survive_pruning(db_session, monkeypatch):
    """Reviewer finding (Task 6, commit 758211f): prune_superseded_excerpts
    (P2) mutates an earlier tool message's "content" VALUE in place, on the
    SAME dict object, once a second retrieval round exists. The old
    iter_boundaries (list[int]) + full[:boundary] cancel-time slicing shared
    those dict objects, so pruning that ran during iteration 2 retroactively
    shrank the round-1 boundary's tokenization at cancel time -- lower than
    what eager per-iteration counting (the old pre-lazy behavior) would have
    produced. The fix snapshots shallow COPIES of each message dict at the
    top of every iteration (iter_prompt_snapshots), so a later prune's
    mutation of the shared dict cannot reach back into an earlier snapshot.

    Two retrieval rounds run (so round 2's prune stubs round 1's excerpt),
    then the third iteration is cancelled mid-stream. Assert the iteration-2
    snapshot (taken before round 2's prune runs) still carries round 1's
    ORIGINAL content, the iteration-3 snapshot (taken after) correctly
    carries the stub, and prompt_tokens_total is exactly the sum of the
    per-snapshot fake-counter results (proving no snapshot is double counted
    or skipped).
    """
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    from agent import tutor

    turn1 = _make_stream(
        _tool_chunk(_tool_fragment(0, id="tc_1", name="retrieve_chunks", arguments='{"query":"a"}')),
    )
    turn2 = _make_stream(
        _tool_chunk(_tool_fragment(0, id="tc_2", name="retrieve_chunks", arguments='{"query":"b"}')),
    )

    async def _slow_stream():
        yield _content_chunk("partial ")
        await asyncio.sleep(10)

    turns = [turn1, turn2, _slow_stream()]

    async def _fake_acompletion(*args, **kwargs):
        return turns.pop(0)

    monkeypatch.setattr("agent.tutor.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=SimpleNamespace())
    )
    monkeypatch.setattr("agent.tutor.litellm.completion_cost", MagicMock(return_value=0.0))

    def _dispatch(name, args, ctx):
        first = args.get("query") == "a"
        chunk = {
            "doc_id": "d1" if first else "d2",
            "doc_name": "notes.pdf" if first else "slides.pdf",
            "text": "old material" if first else "new material",
        }
        return ToolResult(ok=True, status="ok", error=None, data={"chunks": [chunk]})

    monkeypatch.setattr("agent.tutor.tools.dispatch", MagicMock(side_effect=_dispatch))

    counter_calls = []

    def _counter(*a, **k):
        msgs = k.get("messages")
        counter_calls.append(msgs)
        return sum(len(m.get("content") or "") for m in msgs)

    monkeypatch.setattr("agent.tutor.litellm.token_counter", _counter)

    estimate_spy = MagicMock(return_value=Decimal("0.01"))
    monkeypatch.setattr("agent.tutor.cost_meter.estimate_cancelled_cost", estimate_spy)

    ctx = _ctx(db_session, session_id="s_cancel_prune")

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

    # Three iterations were entered before cancel -> three snapshots tokenized.
    assert len(counter_calls) == 3

    # Iteration-2 snapshot (counter_calls[1]) is copied at the TOP of
    # iteration 2 -- BEFORE round 2's dispatch and BEFORE
    # prune_superseded_excerpts runs at the end of that same iteration. Eager
    # per-iteration counting (the pre-lazy behavior) would have counted
    # exactly this prefix, with round 1's excerpt still original. This is the
    # discriminating assertion: the old full[:boundary] slicing re-read the
    # shared (by-then-mutated) list at CANCEL time, so it saw round 1 already
    # stubbed here and undercounted. The snapshot fix must not.
    iter2_tc1 = next(m for m in counter_calls[1] if m.get("tool_call_id") == "tc_1")
    assert "old material" in iter2_tc1["content"]
    assert not iter2_tc1["content"].startswith("[superseded retrieval:")

    # Iteration-3 snapshot (counter_calls[2]) is copied AFTER iteration 2's
    # own prune_superseded_excerpts already stubbed round 1 -- eager
    # per-iteration counting would see the stub here too, so this snapshot
    # legitimately (and correctly) carries the stubbed content. Asserting
    # this guards against an over-correction that keeps every snapshot
    # unstubbed (which would OVER-count vs. eager) and proves prune actually
    # ran, so the iter-2 assertion above isn't trivially vacuous.
    iter3_tc1 = next(m for m in counter_calls[2] if m.get("tool_call_id") == "tc_1")
    assert iter3_tc1["content"].startswith("[superseded retrieval:")

    # prompt_tokens_total must be exactly the sum of the per-snapshot counts
    # -- i.e. eager per-iteration accumulation, reproduced lazily.
    assert estimate_spy.call_count == 1
    prompt_tokens_total = estimate_spy.call_args.args[2]
    expected_total = sum(
        sum(len(m.get("content") or "") for m in msgs) for msgs in counter_calls
    )
    assert prompt_tokens_total == expected_total

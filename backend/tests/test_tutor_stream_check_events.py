"""TDD: run_streaming emits check_question event and terminates turn on ask_check_question.

Mirrors test_tutor_stream.py harness exactly. Helpers are copied from that
module so this file is self-contained.
"""

import json
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent import tutor
from agent.types import ToolContext
from config import settings
from contracts import ToolResult
from db.models import ChatMessage, Session as SessionModel, User as UserModel

from services.cost_meter import CapStatus


# ---------------------------------------------------------------------------
# Streaming chunk builders (copied verbatim from test_tutor_stream.py)
# ---------------------------------------------------------------------------

def _content_chunk(token: str) -> SimpleNamespace:
    """A streamed chunk carrying a single text token."""
    delta = SimpleNamespace(content=token, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def _tool_fragment(index: int, id=None, name=None, arguments=None) -> SimpleNamespace:
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
# Helpers
# ---------------------------------------------------------------------------

SESSION_ID = "sc1"
USER_ID = "u1"


def _insert_session(db_session, session_id=SESSION_ID, user_id=USER_ID):
    """Insert a minimal User + Session row so set_pending_check can find the row."""
    # SQLite in-memory: ForeignKey enforcement depends on pragma; insert user first.
    user = UserModel(id=user_id)
    db_session.add(user)
    db_session.flush()
    sess = SessionModel(id=session_id, user_id=user_id)
    db_session.add(sess)
    db_session.commit()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_emits_check_question_and_breaks(monkeypatch, db_session):
    """ask_check_question dispatch -> check_question event emitted, turn terminates.

    turn1: LLM calls ask_check_question tool.
    turn2: supplied but must NEVER be consumed (loop terminates after ask).
    """
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    _insert_session(db_session, session_id=SESSION_ID)
    ctx = _ctx(db_session, session_id=SESSION_ID)

    turn1 = _make_stream(
        _content_chunk("Question: Inputs?"),
        _tool_chunk(
            _tool_fragment(
                index=0,
                id="tc_1",
                name="ask_check_question",
                arguments=json.dumps(
                    {
                        "session_id": SESSION_ID,
                        "gap": "linear_algebra",
                        "question": "Inputs?",
                        "options": ["vectors", "scalars"],
                        "correct_index": 0,
                        "explanation": "Vectors are inputs.",
                    }
                ),
            )
        ),
    )
    turn2 = _make_stream(_content_chunk("SHOULD-NOT-APPEAR"))

    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=[turn1, turn2]),
    )

    events = await _drain(
        tutor.run_streaming(
            [{"role": "user", "content": "quiz me"}],
            "sys",
            ctx,
        )
    )

    types = [e.type for e in events]

    assert "check_question" in types, f"check_question missing from events: {types}"
    assert "done" in types, f"done missing from events: {types}"

    cq_event = next(e for e in events if e.type == "check_question")
    assert cq_event.data["question"] == "Inputs?"
    assert cq_event.data["gap"] == "linear_algebra"

    # turn must have terminated before turn2 — SHOULD-NOT-APPEAR never streamed
    for e in events:
        text = e.data.get("text", "") if isinstance(e.data, dict) else ""
        assert "SHOULD-NOT-APPEAR" not in text, (
            f"turn2 content leaked into stream: {e}"
        )

    # assistant message must be persisted with status=complete
    msg = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.session_id == SESSION_ID)
        .one()
    )
    assert msg.status == "complete"
    assert msg.role == "assistant"


@pytest.mark.asyncio
async def test_stream_check_question_event_shape(monkeypatch, db_session):
    """check_question event carries gap and question keys."""
    _disable_stub(monkeypatch)
    _allow_cap(monkeypatch)

    sid = "sc2"
    _insert_session(db_session, session_id=sid)
    ctx = _ctx(db_session, session_id=sid)

    turn1 = _make_stream(
        _tool_chunk(
            _tool_fragment(
                index=0,
                id="tc_2",
                name="ask_check_question",
                arguments=json.dumps(
                    {
                        "session_id": sid,
                        "gap": "derivatives",
                        "question": "What is d/dx x^2?",
                        "options": ["2x", "x^2"],
                        "correct_index": 0,
                        "explanation": "d/dx x^2 = 2x.",
                    }
                ),
            )
        ),
    )

    monkeypatch.setattr(
        "agent.tutor.litellm.acompletion",
        AsyncMock(side_effect=[turn1]),
    )

    events = await _drain(
        tutor.run_streaming(
            [{"role": "user", "content": "test me on derivatives"}],
            "sys",
            ctx,
        )
    )

    cq = next((e for e in events if e.type == "check_question"), None)
    assert cq is not None, "check_question event not emitted"
    assert cq.data["gap"] == "derivatives"
    assert cq.data["question"] == "What is d/dx x^2?"

    done = next((e for e in events if e.type == "done"), None)
    assert done is not None, "done event not emitted"
    assert "message_id" in done.data


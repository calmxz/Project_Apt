"""T5: LLM cost cap circuit breaker.

Unit tests for `services.cost_meter` (record/check) and integration tests
that the chat route emits the right 429 / `X-Cost-Warning` envelope.

The integration tests pre-seed `daily_cost_ledger` rather than driving
spend through the LLM, because `litellm.completion_cost` would not produce
useful numbers against the SimpleNamespace fakes the existing
`mock_litellm` fixture returns. Cost recording on the live LLM path is
exercised by `test_tutor_records_cost_per_call`.
"""

from decimal import Decimal
from types import SimpleNamespace

import pytest

from config import settings
from contracts import TopicProfile
from db.models import DailyCostLedger, Session as SessionModel, User
from lib.error_codes import DAILY_COST_CAP_REACHED
from services import cost_meter


USER_ID = "u_cost"
SESSION_ID = "s_cost"


@pytest.fixture
def seed_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()


# ---------------------------------------------------------------------------
# Unit tests: cost_meter primitives
# ---------------------------------------------------------------------------


def test_current_spend_returns_zero_when_no_row(db_session, seed_user):
    assert cost_meter.current_spend(db_session, USER_ID) == Decimal("0.0000")


def test_record_cost_creates_row(db_session, seed_user):
    total = cost_meter.record_cost(db_session, USER_ID, 0.1234)
    assert total == Decimal("0.1234")
    row = db_session.get(DailyCostLedger, (USER_ID, cost_meter._today_utc()))
    assert row is not None
    assert Decimal(str(row.cost_usd)) == Decimal("0.1234")


def test_record_cost_accumulates(db_session, seed_user):
    cost_meter.record_cost(db_session, USER_ID, Decimal("0.5"))
    total = cost_meter.record_cost(db_session, USER_ID, Decimal("0.25"))
    assert total == Decimal("0.7500")


def test_record_cost_ignores_zero_and_negative(db_session, seed_user):
    cost_meter.record_cost(db_session, USER_ID, Decimal("0"))
    cost_meter.record_cost(db_session, USER_ID, Decimal("-1.5"))
    assert cost_meter.current_spend(db_session, USER_ID) == Decimal("0.0000")


def test_check_cap_allowed_below_soft(db_session, seed_user, monkeypatch):
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 2.00)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 3.00)
    cost_meter.record_cost(db_session, USER_ID, Decimal("0.50"))
    status = cost_meter.check_cap(db_session, USER_ID)
    assert status.allowed is True
    assert status.soft_breached is False
    assert status.used == Decimal("0.5000")


def test_check_cap_soft_breached_but_allowed(db_session, seed_user, monkeypatch):
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 2.00)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 3.00)
    cost_meter.record_cost(db_session, USER_ID, Decimal("2.50"))
    status = cost_meter.check_cap(db_session, USER_ID)
    assert status.allowed is True
    assert status.soft_breached is True


def test_check_cap_hard_blocks(db_session, seed_user, monkeypatch):
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 2.00)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 3.00)
    cost_meter.record_cost(db_session, USER_ID, Decimal("3.00"))
    status = cost_meter.check_cap(db_session, USER_ID)
    assert status.allowed is False
    assert status.soft_breached is True


# ---------------------------------------------------------------------------
# Integration: /api/chat envelope
# ---------------------------------------------------------------------------


def test_chat_returns_429_when_hard_cap_reached(
    client, db_session, seed_user, mock_litellm, monkeypatch
):
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 2.00)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 3.00)
    db_session.add(
        DailyCostLedger(
            user_id=USER_ID,
            date_utc=cost_meter._today_utc(),
            cost_usd=Decimal("3.5000"),
        )
    )
    db_session.commit()

    r = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "hi"},
    )
    assert r.status_code == 429
    detail = r.json()["detail"]
    assert detail["code"] == DAILY_COST_CAP_REACHED
    assert Decimal(detail["hard_cap_usd"]) == Decimal("3.00")
    assert Decimal(detail["used_usd"]) == Decimal("3.5000")
    assert "resets_at" in detail


def test_chat_sets_warning_header_when_soft_breached(
    client, db_session, seed_user, mock_litellm, monkeypatch
):
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 2.00)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 3.00)
    db_session.add(
        DailyCostLedger(
            user_id=USER_ID,
            date_utc=cost_meter._today_utc(),
            cost_usd=Decimal("2.5000"),
        )
    )
    db_session.commit()

    r = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "hi"},
    )
    assert r.status_code == 200
    warn = r.headers.get("X-Cost-Warning") or r.headers.get("x-cost-warning")
    assert warn is not None
    assert "soft_cap_breached" in warn
    assert "used_usd=2.5000" in warn
    # soft_cap=2.00 but Decimal(str(2.0)) == "2.0"; accept either rendering.
    assert "soft_cap_usd=2.0" in warn


def test_chat_no_warning_header_when_below_soft(
    client, seed_user, mock_litellm, monkeypatch
):
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 2.00)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 3.00)
    r = client.post(
        "/api/chat",
        json={"user_id": USER_ID, "session_id": SESSION_ID, "message": "hi"},
    )
    assert r.status_code == 200
    assert "X-Cost-Warning" not in r.headers
    assert "x-cost-warning" not in r.headers


# ---------------------------------------------------------------------------
# Tutor loop records cost per acompletion call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tutor_records_cost_per_call(
    db_session, seed_user, monkeypatch
):
    """tutor.run() invokes litellm.acompletion N times; each call's cost
    must accumulate to the per-user daily ledger."""
    from agent import tutor
    from agent.types import ToolContext
    from datetime import datetime, timezone

    # Disable stub so the real loop runs.
    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real-key")

    async def fake_acompletion(**kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="done.", tool_calls=None)
                )
            ]
        )

    monkeypatch.setattr(tutor.litellm, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        tutor.litellm, "completion_cost", lambda completion_response=None: 0.0123
    )

    ctx = ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )
    reply, _calls, _cites = await tutor.run(
        [{"role": "user", "content": "hi"}], "sys", ctx
    )
    assert reply == "done."
    assert cost_meter.current_spend(db_session, USER_ID) == Decimal("0.0123")


@pytest.mark.asyncio
async def test_tutor_short_circuits_on_mid_turn_hard_cap(
    db_session, seed_user, monkeypatch
):
    """If `record_cost` pushes spend past `llm_hard_cap_usd` mid-loop, the
    next iteration must bail before issuing another acompletion."""
    from agent import tutor
    from agent.types import ToolContext
    from datetime import datetime, timezone

    monkeypatch.setattr(settings, "llm_stub", False)
    monkeypatch.setattr(settings, "gemini_api_key", "real-key")
    monkeypatch.setattr(settings, "llm_soft_cap_usd", 0.50)
    monkeypatch.setattr(settings, "llm_hard_cap_usd", 1.00)

    call_count = {"n": 0}

    async def fake_acompletion(**kwargs):
        call_count["n"] += 1
        # Always return a tool call so the loop wants to iterate again.
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=None,
                        tool_calls=[
                            SimpleNamespace(
                                id="t1",
                                type="function",
                                function=SimpleNamespace(
                                    name="retrieve_chunks",
                                    arguments='{"session_id":"s_cost","query":"q"}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )

    monkeypatch.setattr(tutor.litellm, "acompletion", fake_acompletion)
    # First call already pushes spend past the hard cap (1.50 > 1.00).
    monkeypatch.setattr(
        tutor.litellm, "completion_cost", lambda completion_response=None: 1.5000
    )

    ctx = ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )
    reply, _calls, _cites = await tutor.run(
        [{"role": "user", "content": "hi"}], "sys", ctx
    )
    # Exactly one LLM call should have fired; the next iter must short-circuit.
    assert call_count["n"] == 1
    assert reply == tutor.FALLBACK_TEXT

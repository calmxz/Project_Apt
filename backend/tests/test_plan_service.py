"""TDD: plan_service.draft_plan parsing, fallback, and cost metering."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from contracts import LessonDraft
from db.models import User
from services import cost_meter, plan_service


USER_ID = "u1"


@pytest.fixture
def seeded_user(db_session):
    db_session.add(User(id=USER_ID))
    db_session.commit()


@pytest.fixture(autouse=True)
def force_live_llm(monkeypatch):
    # Force the LLM branch (not the stub) regardless of test env.
    monkeypatch.setattr(plan_service.settings, "llm_stub", False)
    monkeypatch.setattr(plan_service.settings, "gemini_api_key", "live")


def _resp(content: str) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


def test_drafts_parsed_into_bounded_list(db_session, seeded_user, monkeypatch):
    payload = json.dumps(
        [{"title": f"Lesson {i}", "goal": f"goal {i}"} for i in range(4)]
    )

    async def fake_acompletion(**kwargs):
        return _resp(payload)

    monkeypatch.setattr(plan_service.litellm, "acompletion", fake_acompletion)
    monkeypatch.setattr(plan_service.litellm, "completion_cost", lambda **kw: 0.0)

    drafts = asyncio.run(
        plan_service.draft_plan(db_session, USER_ID, "Organic Chem", 30, "deadline", 14, None)
    )
    assert all(isinstance(d, LessonDraft) for d in drafts)
    assert [d.title for d in drafts] == ["Lesson 0", "Lesson 1", "Lesson 2", "Lesson 3"]


def test_prompt_branches_by_duration_mode(db_session, seeded_user, monkeypatch):
    captured = {}
    payload = json.dumps([{"title": f"L{i}", "goal": "g"} for i in range(3)])

    async def capture(**kwargs):
        captured["messages"] = kwargs["messages"]
        return _resp(payload)

    monkeypatch.setattr(plan_service.litellm, "acompletion", capture)
    monkeypatch.setattr(plan_service.litellm, "completion_cost", lambda **kw: 0.0)

    asyncio.run(plan_service.draft_plan(db_session, USER_ID, "Calc", 30, "deadline", 21, None))
    deadline_prompt = captured["messages"][-1]["content"]
    assert "deadline of 21 days" in deadline_prompt

    asyncio.run(plan_service.draft_plan(db_session, USER_ID, "Calc", 30, "pace", None, 2))
    pace_prompt = captured["messages"][-1]["content"]
    assert "2 lessons per week" in pace_prompt
    assert "does NOT cap" in pace_prompt


def test_llm_failure_returns_fallback(db_session, seeded_user, monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(plan_service.litellm, "acompletion", boom)
    drafts = asyncio.run(
        plan_service.draft_plan(db_session, USER_ID, "Quantum Physics", 60, "pace", None, 2)
    )
    assert len(drafts) == 1
    assert drafts[0].title == "Quantum Physics"


def test_cost_meter_invoked(db_session, seeded_user, monkeypatch):
    payload = json.dumps(
        [{"title": f"L{i}", "goal": "g"} for i in range(3)]
    )

    async def fake_acompletion(**kwargs):
        return _resp(payload)

    monkeypatch.setattr(plan_service.litellm, "acompletion", fake_acompletion)
    monkeypatch.setattr(plan_service.litellm, "completion_cost", lambda **kw: 0.01)

    assert cost_meter.current_spend(db_session, USER_ID) == 0
    asyncio.run(plan_service.draft_plan(db_session, USER_ID, "Algebra", 30, "deadline", 7, None))
    assert cost_meter.current_spend(db_session, USER_ID) > 0


def test_cap_reached_returns_fallback_without_llm(db_session, seeded_user, monkeypatch):
    # Push spend over the hard cap so check_cap.allowed is False.
    cost_meter.record_cost(db_session, USER_ID, 999)
    db_session.commit()

    async def must_not_call(**kwargs):
        raise AssertionError("LLM should not be called when cap reached")

    monkeypatch.setattr(plan_service.litellm, "acompletion", must_not_call)
    drafts = asyncio.run(
        plan_service.draft_plan(db_session, USER_ID, "Statistics", 15, "pace", None, 1)
    )
    assert len(drafts) == 1
    assert drafts[0].title == "Statistics"

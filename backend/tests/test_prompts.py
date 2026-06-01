"""Tests for agent/prompts.py -- IMMUTABLE_RULES and build_dynamic_context."""

from agent import prompts


def test_dynamic_context_includes_pending_check():
    state = {
        "topic": "Photosynthesis",
        "profile": {},
        "pending_check": {"gap": "calvin_cycle", "question": "Inputs?"},
    }
    out = prompts.build_dynamic_context(state)
    assert "PENDING_CHECK" in out
    assert "calvin_cycle" in out


def test_dynamic_context_pending_check_none():
    out = prompts.build_dynamic_context({"topic": "x", "profile": {}})
    assert "PENDING_CHECK: none" in out


def test_immutable_rules_mention_ask_check_question():
    assert "ask_check_question" in prompts.IMMUTABLE_RULES

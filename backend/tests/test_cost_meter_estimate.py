"""TDD tests for MODEL_RATES and estimate_cancelled_cost in services.cost_meter.

These tests must FAIL before the implementation is added to cost_meter.py.
"""

from decimal import Decimal

from config import settings
from services.cost_meter import estimate_cancelled_cost, MODEL_RATES


def test_model_rates_has_default_model():
    """The configured default model must have a rate entry so it never KeyErrors in production."""
    assert settings.model in MODEL_RATES, (
        f"MODEL_RATES is missing entry for configured model '{settings.model}'"
    )
    rates = MODEL_RATES[settings.model]
    assert "input_per_1k" in rates
    assert "output_per_1k" in rates
    assert isinstance(rates["input_per_1k"], Decimal)
    assert isinstance(rates["output_per_1k"], Decimal)


def test_estimate_cancelled_cost_returns_decimal():
    """A non-empty delta with non-zero prompt_tokens returns a positive Decimal."""
    cost = estimate_cancelled_cost(
        model=settings.model,
        delta_text="This is some streamed output text.",
        prompt_tokens=500,
    )
    assert isinstance(cost, Decimal)
    assert cost > Decimal("0")


def test_estimate_grows_with_delta_length():
    """A longer delta_text produces a strictly larger cost than a shorter one."""
    short_cost = estimate_cancelled_cost(
        model=settings.model,
        delta_text="short",
        prompt_tokens=100,
    )
    long_cost = estimate_cancelled_cost(
        model=settings.model,
        delta_text="This is a much longer piece of streamed text that contains many more tokens.",
        prompt_tokens=100,
    )
    assert long_cost > short_cost


def test_estimate_zero_delta_only_charges_prompt():
    """With delta_text='' and prompt_tokens=1000, cost equals exactly the prompt portion."""
    rates = MODEL_RATES[settings.model]
    expected = (Decimal(1000) * rates["input_per_1k"]) / Decimal(1000)
    cost = estimate_cancelled_cost(
        model=settings.model,
        delta_text="",
        prompt_tokens=1000,
    )
    assert cost == expected


def test_unknown_model_falls_back_to_litellm_price_table(monkeypatch):
    """P2 AC5: an unregistered model id must not raise mid-turn."""
    monkeypatch.setattr(
        "services.cost_meter.litellm.token_counter", lambda model, text: 10
    )
    monkeypatch.setattr(
        "services.cost_meter.litellm.cost_per_token",
        lambda model, prompt_tokens, completion_tokens: (0.001, 0.002),
    )
    cost = estimate_cancelled_cost("some/unknown-model", "partial reply", 100)
    assert cost == Decimal("0.003")


def test_unknown_model_double_failure_returns_zero(monkeypatch):
    monkeypatch.setattr(
        "services.cost_meter.litellm.token_counter", lambda model, text: 10
    )
    def _boom(**kwargs):
        raise ValueError("model not mapped")
    monkeypatch.setattr("services.cost_meter.litellm.cost_per_token", _boom)
    cost = estimate_cancelled_cost("some/unknown-model", "partial reply", 100)
    assert cost == Decimal("0")

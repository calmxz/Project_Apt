"""Per-user daily LLM spend tracking and cap enforcement.

Soft cap → `X-Cost-Warning` response header.
Hard cap → 429 `daily_cost_cap_reached` (enforced server-side before the LLM
call so a busted account cannot be made to spend more by abusive callers).

UTC midnight rollover is implicit: rows are keyed on (user_id, date_utc), so
a new day starts a new row at 0.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import litellm
from sqlalchemy.orm import Session

from config import settings
from db.models import DailyCostLedger, LlmCallLog


log = logging.getLogger(__name__)

_ZERO = Decimal("0.0000")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def midnight_utc_iso() -> str:
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return tomorrow.isoformat()


def _quantize(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.0001"))


def _to_decimal(v) -> Decimal:
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


@dataclass(frozen=True)
class CapStatus:
    allowed: bool
    used: Decimal
    soft_breached: bool
    urgent_breached: bool
    soft_cap: Decimal
    urgent_cap: Decimal
    hard_cap: Decimal


def current_spend(db: Session, user_id: str) -> Decimal:
    row = db.get(DailyCostLedger, (user_id, _today_utc()))
    if row is None:
        return _ZERO
    return _to_decimal(row.cost_usd)


def record_cost(db: Session, user_id: str, cost_usd) -> Decimal:
    """Add `cost_usd` to today's ledger row for `user_id`. Returns the new
    total. Safe to call with `0` (no-op write avoided)."""
    cost = _to_decimal(cost_usd)
    if cost <= _ZERO:
        return current_spend(db, user_id)

    date_utc = _today_utc()
    row = db.get(DailyCostLedger, (user_id, date_utc))
    if row is None:
        row = DailyCostLedger(user_id=user_id, date_utc=date_utc, cost_usd=_quantize(cost))
        db.add(row)
    else:
        row.cost_usd = _quantize(_to_decimal(row.cost_usd) + cost)
    db.flush()
    return _to_decimal(row.cost_usd)


def log_call(
    db: Session, *, user_id: str, session_id, purpose: str, model: str, cost_usd,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cached_tokens: int | None = None,
) -> None:
    """Best-effort per-call attribution row. Never raises: a failed log
    write must not fail the user's turn. Cap gating stays on the daily
    ledger; this table is analytics-only (roadmap R3 consumes it).

    The write happens inside a SAVEPOINT (`db.begin_nested()`): if the flush
    fails, only this row's sub-transaction rolls back -- the outer session
    (and any earlier work in the same turn, e.g. record_cost's ledger write)
    stays usable. Without this, a failed flush would leave the session in
    SQLAlchemy's "rollback-required" state and the next unguarded db.commit()
    in the caller would raise, failing the user's turn -- the opposite of the
    isolation this function exists to provide.
    """
    try:
        cost = _to_decimal(cost_usd)
        if cost <= _ZERO:
            return
        with db.begin_nested():
            db.add(LlmCallLog(
                user_id=user_id, session_id=session_id, purpose=purpose,
                model=model, cost_usd=_quantize(cost),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cached_tokens=cached_tokens,
            ))
    except Exception as e:  # noqa: BLE001 - isolation by design
        log.warning("llm_call_log write failed: %s", e)


def extract_usage(resp) -> dict:
    """Tolerantly read token usage off a LiteLLM response (acompletion result
    or stream_chunk_builder output). Returns exactly the keys log_call accepts
    as token kwargs, so callers can splat: log_call(..., **extract_usage(r)).

    cached_tokens carries the Gemini implicit-prefix-cache hit count. LiteLLM
    normalizes Gemini's cachedContentTokenCount into OpenAI-style
    usage.prompt_tokens_details.cached_tokens on current versions; the raw
    Gemini field name is probed as a fallback. Instrumentation only -- never
    raises (it runs inside the billed turn path).
    """
    out = {"prompt_tokens": None, "completion_tokens": None, "cached_tokens": None}
    try:
        usage = getattr(resp, "usage", None)
        if usage is None:
            return out
        out["prompt_tokens"] = getattr(usage, "prompt_tokens", None)
        out["completion_tokens"] = getattr(usage, "completion_tokens", None)
        details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            cached = getattr(details, "cached_tokens", None)
            if cached is None:
                cached = getattr(details, "cached_content_token_count", None)
            out["cached_tokens"] = cached
    except Exception:  # noqa: BLE001 - instrumentation must never break a turn
        pass
    return out


def check_cap(db: Session, user_id: str) -> CapStatus:
    soft_cap = _to_decimal(settings.llm_soft_cap_usd)
    hard_cap = _to_decimal(settings.llm_hard_cap_usd)
    urgent_cap = _quantize(hard_cap * Decimal("0.9"))
    used = current_spend(db, user_id)
    return CapStatus(
        allowed=used < hard_cap,
        used=used,
        soft_breached=used >= soft_cap,
        urgent_breached=used >= urgent_cap,
        soft_cap=soft_cap,
        urgent_cap=urgent_cap,
        hard_cap=hard_cap,
    )


# Per-1000-token USD rates. VERIFY against live pricing before launch; update on model/pricing change.
MODEL_RATES: dict[str, dict[str, Decimal]] = {
    # Google Gemini 3.1 Flash-Lite — flash-lite tier (placeholder; verify at ai.google.dev/pricing)
    "gemini/gemini-3.1-flash-lite": {
        "input_per_1k": Decimal("0.000075"),   # $0.075 / 1M tokens
        "output_per_1k": Decimal("0.000300"),  # $0.30  / 1M tokens
    },
    # Anthropic Claude Sonnet 4.6 — project fallback model if gemini underperforms (verify at anthropic.com/pricing)
    "anthropic/claude-sonnet-4-6": {
        "input_per_1k": Decimal("0.003"),      # $3.00  / 1M tokens
        "output_per_1k": Decimal("0.015"),     # $15.00 / 1M tokens
    },
}


def estimate_cancelled_cost(model: str, delta_text: str, prompt_tokens: int) -> Decimal:
    """Return an estimated USD cost for a cancelled streaming LLM reply.

    Charges the full prompt cost (all tokens were sent to the model before
    cancellation) plus the output cost for however many tokens were streamed
    in `delta_text`.

    The returned value is intentionally NOT quantized: record_cost quantizes
    on write, so accumulating raw sub-cent cancellation costs before truncation
    preserves arithmetic accuracy across multiple cancelled turns.

    litellm.token_counter confirmed to return sane (non-zero) counts for
    'gemini/gemini-3.1-flash-lite' — returns 6 for a 6-word phrase — so no
    fallback guard is needed for this model id.

    Unknown models fall back to litellm.cost_per_token, then to 0.
    """
    rates = MODEL_RATES.get(model)
    output_tokens = litellm.token_counter(model=model, text=delta_text or "")
    if rates is not None:
        prompt_cost = Decimal(prompt_tokens) * rates["input_per_1k"]
        output_cost = Decimal(output_tokens) * rates["output_per_1k"]
        return (prompt_cost + output_cost) / Decimal(1000)
    try:
        prompt_usd, completion_usd = litellm.cost_per_token(
            model=model, prompt_tokens=prompt_tokens, completion_tokens=output_tokens
        )
        return _to_decimal(prompt_usd) + _to_decimal(completion_usd)
    except Exception as e:  # noqa: BLE001 - cancellation metering must not raise
        log.warning("cost fallback failed for model %s: %s", model, e)
        return Decimal("0")

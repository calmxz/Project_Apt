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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import settings
from db.models import DailyCostLedger, LlmCallLog
from services.sql_dialect import dialect_insert


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
    """Today's spend, read with a fresh SELECT every call (F-43).

    db.get returns the identity-map cache without emitting SQL after the
    first read, which hides other sessions' concurrent spend from the
    mid-turn cap checks in the tutor loop.
    """
    total = db.execute(
        select(func.coalesce(func.sum(DailyCostLedger.cost_usd), 0)).where(
            DailyCostLedger.user_id == user_id,
            DailyCostLedger.date_utc == _today_utc(),
        )
    ).scalar_one()
    return _to_decimal(total)


def record_cost(db: Session, user_id: str, cost_usd) -> Decimal:
    """Atomically add `cost_usd` to today's ledger row for `user_id` and
    return the new total (F-17: INSERT .. ON CONFLICT DO UPDATE, so two
    concurrent writers serialize on the row instead of read-modify-writing
    a stale total). Safe to call with 0 (no-op write avoided). Flushes into
    the caller's transaction; the caller's commit publishes it.
    """
    cost = _quantize(_to_decimal(cost_usd))
    if cost <= _ZERO:
        return current_spend(db, user_id)

    ins = dialect_insert(db)(DailyCostLedger).values(
        user_id=user_id, date_utc=_today_utc(), cost_usd=cost
    )
    stmt = ins.on_conflict_do_update(
        index_elements=["user_id", "date_utc"],
        set_={
            "cost_usd": DailyCostLedger.cost_usd + ins.excluded.cost_usd,
            # onupdate defaults do not fire for ON CONFLICT set_; stamp explicitly.
            "updated_at": datetime.now(timezone.utc),
        },
    ).returning(DailyCostLedger.cost_usd)
    new_total = db.execute(stmt).scalar_one()
    return _to_decimal(new_total)


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


def check_cap_from_spend(used: Decimal) -> CapStatus:
    soft_cap = _to_decimal(settings.llm_soft_cap_usd)
    hard_cap = _to_decimal(settings.llm_hard_cap_usd)
    urgent_cap = _quantize(hard_cap * Decimal("0.9"))
    return CapStatus(
        allowed=used < hard_cap,
        used=used,
        soft_breached=used >= soft_cap,
        urgent_breached=used >= urgent_cap,
        soft_cap=soft_cap,
        urgent_cap=urgent_cap,
        hard_cap=hard_cap,
    )


def check_cap(db: Session, user_id: str) -> CapStatus:
    return check_cap_from_spend(current_spend(db, user_id))


def spend_subquery(user_id: str):
    """Scalar subquery: today's spend for user_id (0/NULL when no row).

    Same table, columns, and date window as current_spend (DailyCostLedger,
    keyed on user_id + _today_utc()) -- keep them in lockstep.
    """
    return (
        select(func.coalesce(func.sum(DailyCostLedger.cost_usd), 0))
        .where(
            DailyCostLedger.user_id == user_id,
            DailyCostLedger.date_utc == _today_utc(),
        )
        .scalar_subquery()
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
    # Google Gemini embedding model — placeholder; verify at ai.google.dev/pricing
    "gemini/gemini-embedding-2": {
        "input_per_1k": Decimal("0.000150"),  # $0.15 / 1M tokens
        "output_per_1k": Decimal("0"),
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


def embedding_cost(model: str, resp, texts: list[str]) -> Decimal:
    """USD cost of a litellm.embedding response.

    Tries litellm's own accounting first; on failure (pricing-table gap for
    the model id) falls back to token math against MODEL_RATES so real spend
    never silently registers as 0 (F-19). Unknown models return 0 with a
    warning.
    """
    try:
        cost = litellm.completion_cost(completion_response=resp)
        if cost and cost > 0:
            return _to_decimal(cost)
    except Exception as e:  # noqa: BLE001 - metering must not raise
        log.warning("embedding completion_cost failed: %s", e)
    rates = MODEL_RATES.get(model)
    if rates is None:
        log.warning("no MODEL_RATES entry for embedding model %s; cost=0", model)
        return Decimal("0")
    try:
        tokens = extract_usage(resp)["prompt_tokens"]
        if tokens is None:
            tokens = sum(
                litellm.token_counter(model=model, text=t or "") for t in texts
            )
        return Decimal(tokens) * rates["input_per_1k"] / Decimal(1000)
    except Exception as e:  # noqa: BLE001
        log.warning("embedding token-math fallback failed: %s", e)
        return Decimal("0")


def meter_embedding_response(
    db: Session, resp, *, user_id: str, session_id, texts: list[str],
    purpose: str = "embedding",
) -> None:
    """Record an embedding call on the capped ledger and the analytics log
    (F-19). Never raises: metering must not fail the calling feature."""
    try:
        cost = embedding_cost(settings.embedding_model, resp, texts)
        record_cost(db, user_id, cost)
        log_call(
            db, user_id=user_id, session_id=session_id, purpose=purpose,
            model=settings.embedding_model, cost_usd=cost,
            **extract_usage(resp),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("embedding metering failed: %s", e)

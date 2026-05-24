"""Per-user daily LLM spend tracking and cap enforcement.

Soft cap → `X-Cost-Warning` response header.
Hard cap → 429 `daily_cost_cap_reached` (enforced server-side before the LLM
call so a busted account cannot be made to spend more by abusive callers).

UTC midnight rollover is implicit: rows are keyed on (user_id, date_utc), so
a new day starts a new row at 0.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from config import settings
from db.models import DailyCostLedger


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
    soft_cap: Decimal
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


def check_cap(db: Session, user_id: str) -> CapStatus:
    soft_cap = _to_decimal(settings.llm_soft_cap_usd)
    hard_cap = _to_decimal(settings.llm_hard_cap_usd)
    used = current_spend(db, user_id)
    return CapStatus(
        allowed=used < hard_cap,
        used=used,
        soft_breached=used >= soft_cap,
        soft_cap=soft_cap,
        hard_cap=hard_cap,
    )

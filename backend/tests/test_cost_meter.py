from decimal import Decimal

from sqlalchemy import select, text

from db.models import DailyCostLedger, User
from services import cost_meter


def _mk_user(db, uid):
    db.add(User(id=uid))
    db.flush()


def test_check_cap_urgent_tier(db_session, monkeypatch):
    # hard cap $3 -> urgent at $2.70; soft at $2
    user = "u1"
    # below soft
    cost_meter.record_cost(db_session, user, Decimal("1.00"))
    db_session.commit()
    s = cost_meter.check_cap(db_session, user)
    assert (s.soft_breached, s.urgent_breached, s.allowed) == (False, False, True)
    # soft but not urgent
    cost_meter.record_cost(db_session, user, Decimal("1.20"))
    db_session.commit()  # 2.20
    s = cost_meter.check_cap(db_session, user)
    assert (s.soft_breached, s.urgent_breached, s.allowed) == (True, False, True)
    # urgent but not hard
    cost_meter.record_cost(db_session, user, Decimal("0.60"))
    db_session.commit()  # 2.80
    s = cost_meter.check_cap(db_session, user)
    assert (s.soft_breached, s.urgent_breached, s.allowed) == (True, True, True)
    assert s.urgent_cap == Decimal("2.70")
    # hard
    cost_meter.record_cost(db_session, user, Decimal("0.50"))
    db_session.commit()  # 3.30
    s = cost_meter.check_cap(db_session, user)
    assert s.allowed is False


def test_check_cap_from_spend_matches_check_cap_semantics():
    st = cost_meter.check_cap_from_spend(Decimal("0"))
    assert st.allowed and not st.soft_breached and not st.urgent_breached
    st = cost_meter.check_cap_from_spend(Decimal("2.50"))
    assert st.allowed and st.soft_breached
    st = cost_meter.check_cap_from_spend(Decimal("3.00"))
    assert not st.allowed


def test_spend_subquery_returns_todays_spend(db_session):
    cost_meter.record_cost(db_session, "sq-user", Decimal("0.25"))
    used = db_session.execute(
        select(cost_meter.spend_subquery("sq-user"))
    ).scalar_one()
    assert Decimal(str(used or 0)) == Decimal("0.25")


def test_spend_subquery_zero_when_no_ledger_row(db_session):
    used = db_session.execute(
        select(cost_meter.spend_subquery("nobody"))
    ).scalar_one()
    assert Decimal(str(used or 0)) == Decimal("0")


def test_current_spend_reads_through_identity_map(db_session):
    # F-43: db.get returns the identity-map cache without SQL, hiding other
    # sessions' concurrent spend. current_spend must emit a fresh SELECT.
    _mk_user(db_session, "u43")
    cost_meter.record_cost(db_session, "u43", Decimal("0.5"))
    db_session.commit()
    # Prime the identity map the way a long turn does.
    assert cost_meter.current_spend(db_session, "u43") == Decimal("0.5000")
    # Mutate the row behind the ORM's back (simulates another session's commit).
    db_session.execute(
        text("UPDATE daily_cost_ledger SET cost_usd = 2.0 WHERE user_id = 'u43'")
    )
    assert cost_meter.current_spend(db_session, "u43") == Decimal("2.0000")


def test_record_cost_is_an_atomic_increment(db_session):
    # F-17: record_cost must not read-modify-write. After the ORM has a stale
    # cached instance, a subsequent record_cost must still add to the DB
    # value, not to the cached one.
    _mk_user(db_session, "u17")
    cost_meter.record_cost(db_session, "u17", Decimal("0.5"))
    db_session.commit()
    row = db_session.get(DailyCostLedger, ("u17", cost_meter._today_utc()))
    assert row is not None  # instance now cached with 0.5
    db_session.execute(
        text("UPDATE daily_cost_ledger SET cost_usd = 1.0 WHERE user_id = 'u17'")
    )
    total = cost_meter.record_cost(db_session, "u17", Decimal("0.25"))
    # Read-modify-write on the cached 0.5 would yield 0.75; atomic SQL yields 1.25.
    assert total == Decimal("1.2500")


def test_record_cost_returns_running_total_and_quantizes(db_session):
    _mk_user(db_session, "uq")
    assert cost_meter.record_cost(db_session, "uq", 0.00006) == Decimal("0.0001")
    assert cost_meter.record_cost(db_session, "uq", Decimal("0.1")) == Decimal("0.1001")
    # Sub-precision cost quantizes to zero and is a no-op.
    assert cost_meter.record_cost(db_session, "uq", 0.00001) == Decimal("0.1001")

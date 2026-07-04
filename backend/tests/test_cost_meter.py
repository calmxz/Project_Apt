from decimal import Decimal

from services import cost_meter


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

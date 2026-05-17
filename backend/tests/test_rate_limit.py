from config import settings
from services.rate_limit import check_and_increment


def test_cap_allows_up_to_limit(db_session):
    for i in range(settings.daily_cap):
        allowed, used = check_and_increment(db_session, "u1")
        assert allowed is True
        assert used == i + 1


def test_cap_blocks_on_exceed(db_session):
    for _ in range(settings.daily_cap):
        check_and_increment(db_session, "u1")
    allowed, used = check_and_increment(db_session, "u1")
    assert allowed is False
    assert used == settings.daily_cap


def test_different_users_isolated(db_session):
    for _ in range(settings.daily_cap):
        check_and_increment(db_session, "u1")
    allowed, used = check_and_increment(db_session, "u2")
    assert allowed is True
    assert used == 1


def test_next_day_resets(db_session, monkeypatch):
    import services.rate_limit as rl

    monkeypatch.setattr(rl, "_today_utc", lambda: "2099-01-01")
    for _ in range(settings.daily_cap):
        check_and_increment(db_session, "u1")
    allowed, _ = check_and_increment(db_session, "u1")
    assert allowed is False

    monkeypatch.setattr(rl, "_today_utc", lambda: "2099-01-02")
    allowed, used = check_and_increment(db_session, "u1")
    assert allowed is True
    assert used == 1

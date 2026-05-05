from config import settings
from services.rate_limit import check_and_increment


def test_cap_allows_up_to_limit(db_session):
    for _ in range(settings.daily_cap):
        assert check_and_increment(db_session, "u1") is True


def test_cap_blocks_on_exceed(db_session):
    for _ in range(settings.daily_cap):
        check_and_increment(db_session, "u1")
    assert check_and_increment(db_session, "u1") is False


def test_different_users_isolated(db_session):
    for _ in range(settings.daily_cap):
        check_and_increment(db_session, "u1")
    assert check_and_increment(db_session, "u2") is True


def test_next_day_resets(db_session, monkeypatch):
    import services.rate_limit as rl

    monkeypatch.setattr(rl, "_today_utc", lambda: "2099-01-01")
    for _ in range(settings.daily_cap):
        check_and_increment(db_session, "u1")
    assert check_and_increment(db_session, "u1") is False

    monkeypatch.setattr(rl, "_today_utc", lambda: "2099-01-02")
    assert check_and_increment(db_session, "u1") is True

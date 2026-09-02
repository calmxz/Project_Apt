import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from config import settings
from lib.error_codes import TOO_MANY_REQUESTS
from services import velocity_limit
from services.auth import current_user_id


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    velocity_limit.reset()
    monkeypatch.setattr(settings, "burst_limit_per_minute", 3)
    yield
    velocity_limit.reset()


def test_allows_up_to_limit_then_blocks():
    clock = [1000.0]
    for _ in range(3):
        assert velocity_limit.check("u1", now=clock[0]) is None
    retry = velocity_limit.check("u1", now=clock[0])
    assert isinstance(retry, int) and 1 <= retry <= 60


def test_window_slides():
    assert velocity_limit.check("u1", now=0.0) is None
    assert velocity_limit.check("u1", now=1.0) is None
    assert velocity_limit.check("u1", now=2.0) is None
    assert velocity_limit.check("u1", now=2.5) == 58  # oldest (t=0) expires at 60
    assert velocity_limit.check("u1", now=60.1) is None


def test_users_isolated():
    for _ in range(3):
        velocity_limit.check("u1", now=0.0)
    assert velocity_limit.check("u2", now=0.0) is None


def test_zero_disables(monkeypatch):
    monkeypatch.setattr(settings, "burst_limit_per_minute", 0)
    for _ in range(50):
        assert velocity_limit.check("u1", now=0.0) is None


def test_idle_user_evicted_on_sweep():
    velocity_limit.check("idle_user", now=0.0)
    assert "idle_user" in velocity_limit._hits

    # Push _hits past the sweep threshold with fresh users at a time far
    # enough past idle_user's window (60s) that it is fully expired.
    for i in range(velocity_limit._SWEEP_THRESHOLD + 1):
        velocity_limit.check(f"user{i}", now=100.0)

    assert "idle_user" not in velocity_limit._hits


def test_dependency_returns_429_envelope():
    app = FastAPI()

    @app.post("/paid", dependencies=[Depends(velocity_limit.enforce_velocity)])
    def paid():
        return {"ok": True}

    app.dependency_overrides[current_user_id] = lambda: "u9"
    c = TestClient(app)
    for _ in range(3):
        assert c.post("/paid").status_code == 200
    r = c.post("/paid")
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == TOO_MANY_REQUESTS
    assert int(r.headers["Retry-After"]) >= 1

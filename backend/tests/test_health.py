import pytest

from config import settings
from routes import health as health_route


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_healthz_alias(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_ok_when_db_reachable(client):
    """G-07: /health is a liveness probe (the process answers). /ready adds
    the dependency the process cannot serve traffic without."""
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_unavailable_when_db_raises(client, monkeypatch):
    def boom(_db):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(health_route, "_probe", boom)

    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


def test_ready_unavailable_when_probe_exceeds_timeout(client, monkeypatch):
    """A hung pool must fail the probe on a budget rather than holding the
    health check open until Render's own timeout."""
    import time

    def slow(_db):
        time.sleep(1.0)

    monkeypatch.setattr(health_route, "_probe", slow)
    monkeypatch.setattr(settings, "readiness_timeout_s", 0.05)

    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


@pytest.mark.parametrize("path", ["/health", "/healthz"])
def test_liveness_probes_do_not_touch_the_db(client, monkeypatch, path):
    def boom(_db):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(health_route, "_probe", boom)
    assert client.get(path).status_code == 200

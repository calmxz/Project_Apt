import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RENDER = REPO_ROOT / "render.yaml"
VERCEL = REPO_ROOT / "frontend" / "vercel.json"
COMPOSE_FILES = (REPO_ROOT / "docker-compose.yml", REPO_ROOT / "docker-compose.prod.yml")


def _load(path):
    p = Path(path)
    if not p.is_absolute():
        p = REPO_ROOT / p
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def test_render_yaml_parses():
    data = yaml.safe_load(RENDER.read_text(encoding="utf-8"))
    assert "services" in data


def test_render_service_shape():
    data = yaml.safe_load(RENDER.read_text(encoding="utf-8"))
    svc = data["services"][0]
    assert svc["type"] == "web"
    assert svc["runtime"] == "docker"
    assert svc["healthCheckPath"] == "/health"
    assert svc["plan"] == "free"
    assert svc["dockerfilePath"] == "./backend/Dockerfile"


def test_render_secrets_not_inlined():
    data = yaml.safe_load(RENDER.read_text(encoding="utf-8"))
    env_vars = {e["key"]: e for e in data["services"][0]["envVars"]}
    for secret in (
        "GEMINI_API_KEY",
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "CORS_ORIGINS",
    ):
        assert env_vars[secret].get("sync") is False
        assert "value" not in env_vars[secret]


def test_vercel_json_parses():
    json.loads(VERCEL.read_text(encoding="utf-8"))


def test_vercel_spa_rewrite():
    data = json.loads(VERCEL.read_text(encoding="utf-8"))
    dests = [r["destination"] for r in data["rewrites"]]
    assert "/index.html" in dests


def test_vercel_has_security_headers_but_not_csp():
    # P3 I-06: Content-Security-Policy is deliberately NOT a vercel.json header.
    # It is injected at build time as a <meta http-equiv="Content-Security-Policy">
    # tag by frontend/cspPlugin.js (behavior covered by
    # frontend/src/__tests__/cspPlugin.test.js), because the header value needs
    # to interpolate VITE_API_BASE_URL, which vercel.json cannot do. Do not
    # "restore" a Content-Security-Policy header here.
    data = json.loads(VERCEL.read_text(encoding="utf-8"))
    headers = data["headers"][0]["headers"]
    keys = {h["key"] for h in headers}
    assert "Content-Security-Policy" not in keys
    assert "X-Content-Type-Options" in keys
    assert "X-Frame-Options" in keys
    assert "Referrer-Policy" in keys


def test_compose_files_define_worker_service():
    for path in ("docker-compose.yml", "docker-compose.prod.yml"):
        cfg = _load(path)
        worker = cfg["services"]["worker"]
        assert worker["command"] == ["python", "-m", "worker"]
        assert "ports" not in worker
        assert worker["healthcheck"] == {"disable": True}


def test_render_defines_worker_service():
    cfg = _load("render.yaml")
    names = {s["name"]: s for s in cfg["services"]}
    w = names["crux-worker"]
    assert w["type"] == "worker"
    assert w["dockerCommand"] == "python -m worker"

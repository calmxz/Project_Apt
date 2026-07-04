import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RENDER = REPO_ROOT / "render.yaml"
VERCEL = REPO_ROOT / "frontend" / "vercel.json"


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


def test_vercel_has_csp():
    data = json.loads(VERCEL.read_text(encoding="utf-8"))
    headers = data["headers"][0]["headers"]
    keys = {h["key"] for h in headers}
    assert "Content-Security-Policy" in keys
    assert "X-Content-Type-Options" in keys

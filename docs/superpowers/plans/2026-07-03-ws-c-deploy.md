# WS-C Deploy Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the FastAPI backend on Render and the Vue frontend on Vercel (default host URLs), both reaching the existing Supabase Postgres + Auth, with all deploy config as reviewable in-repo code and a step-by-step runbook for the manual dashboard steps.

**Architecture:** Backend runs as a Render Docker web service; a container entrypoint migrates then `exec`s uvicorn bound to Render's injected `$PORT`. Frontend is a static Vite build on Vercel Hobby with an SPA rewrite and a CSP header block (no nginx exists in this topology). Secrets live only in host dashboards. A fail-fast guard refuses to boot prod on sqlite.

**Tech Stack:** Render (Docker), Vercel (Vite static), FastAPI/uvicorn, Alembic, Supabase Postgres + pgvector, pydantic-settings.

**Spec:** `docs/superpowers/specs/2026-07-03-ws-c-deploy-design.md`

## Global Constraints

- Backend host = Render **free** tier. Frontend host = Vercel **Hobby, no payment card on file**. (Copied from umbrella locked decisions.)
- Default host URLs only (`*.onrender.com`, `*.vercel.app`). No custom domain.
- **No secret value in git.** Every secret is declared with `sync: false` (Render) or set in the Vercel dashboard; values are entered manually per the runbook. Never Read `.env`.
- No emojis in code or comments.
- Deploy-only scope: F3 persistent rate limit (→ WS-F), R2 upload/backup storage (→ WS-D), Render paid disk, and keep-alive are all out of scope.
- Backend env var names must match `backend/config.py` field names (pydantic-settings is case-insensitive, so `DATABASE_URL` → `database_url`).
- Frontend env vars are exactly: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CHAT_STREAM`.

---

## File Structure

- Create `backend/entrypoint.sh` — migrate-then-exec container start script.
- Modify `backend/Dockerfile` — call entrypoint, honor `$PORT`, keep it executable.
- Modify `backend/config.py` — add pure `assert_prod_database()` guard function.
- Modify `backend/main.py` — call the guard in the existing lifespan.
- Create `render.yaml` (repo root) — Render Blueprint.
- Create `frontend/vercel.json` — SPA rewrite + security headers.
- Create `docs/deploy/RUNBOOK.md` — ordered manual deploy steps.
- Tests: `backend/tests/test_prod_db_guard.py`, `backend/tests/test_entrypoint.py`, `backend/tests/test_deploy_config.py`.

---

### Task 1: Prod DB fail-fast guard

Prevents a misconfigured prod from silently booting on ephemeral sqlite (models require pgvector on Postgres) while passing the shallow `/health` check.

**Files:**
- Modify: `backend/config.py` (add module-level function after the `Settings` class, near line 52)
- Modify: `backend/main.py:11-16` (lifespan)
- Test: `backend/tests/test_prod_db_guard.py`

**Interfaces:**
- Produces: `assert_prod_database(env: str, database_url: str) -> None` in `config.py`. Raises `RuntimeError` when `env == "prod"` and `database_url` starts with `sqlite`; returns `None` otherwise.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_prod_db_guard.py`:

```python
import pytest

from config import assert_prod_database


def test_prod_sqlite_refused():
    with pytest.raises(RuntimeError, match="Postgres"):
        assert_prod_database("prod", "sqlite:///./data/app.db")


def test_prod_postgres_ok():
    assert assert_prod_database("prod", "postgresql://u:p@host:5432/db") is None


def test_dev_sqlite_ok():
    assert assert_prod_database("dev", "sqlite:///./data/app.db") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_prod_db_guard.py -v`
Expected: FAIL with `ImportError: cannot import name 'assert_prod_database'`

- [ ] **Step 3: Add the guard function**

In `backend/config.py`, after the `Settings` class definition and before `settings = Settings()` (around line 53), add:

```python
def assert_prod_database(env: str, database_url: str) -> None:
    if env == "prod" and database_url.startswith("sqlite"):
        raise RuntimeError(
            "database_url must be a Postgres URL when env=prod (got sqlite). "
            "Set DATABASE_URL to the Supabase Postgres connection string."
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_prod_db_guard.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Wire the guard into startup**

In `backend/main.py`, change the import on line 6 and the lifespan body:

```python
from config import assert_prod_database, settings
```

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_prod_database(settings.env, settings.database_url)
    if settings.env == "prod" and not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required when ENV=prod")
    create_tables()
    yield
```

- [ ] **Step 6: Run the backend suite to confirm no regression**

Run: `cd backend && pytest -q`
Expected: PASS (existing tests still green; dev-default env=dev so guard is a no-op at import)

- [ ] **Step 7: Commit**

```bash
git add backend/config.py backend/main.py backend/tests/test_prod_db_guard.py
git commit -m "feat(deploy): fail-fast guard against sqlite in prod"
```

---

### Task 2: Dockerfile + entrypoint hardening

Fixes the three defects that block a working Render deploy: hardcoded port, no migrate-on-deploy, and SIGTERM not reaching uvicorn.

**Files:**
- Create: `backend/entrypoint.sh`
- Modify: `backend/Dockerfile:19-30`
- Test: `backend/tests/test_entrypoint.py`

**Interfaces:**
- Produces: `backend/entrypoint.sh` that runs `alembic upgrade head` then `exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_entrypoint.py`:

```python
from pathlib import Path

ENTRYPOINT = Path(__file__).resolve().parent.parent / "entrypoint.sh"


def _text():
    return ENTRYPOINT.read_text(encoding="utf-8")


def test_entrypoint_exists():
    assert ENTRYPOINT.is_file()


def test_migrate_before_exec():
    text = _text()
    assert "alembic upgrade head" in text
    assert "exec uvicorn" in text
    assert text.index("alembic upgrade head") < text.index("exec uvicorn")


def test_honors_injected_port():
    assert "${PORT:-8000}" in _text()


def test_fails_fast_on_error():
    assert "set -e" in _text()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_entrypoint.py -v`
Expected: FAIL on `test_entrypoint_exists` (file missing)

- [ ] **Step 3: Create the entrypoint script**

Create `backend/entrypoint.sh`:

```sh
#!/bin/sh
set -e
alembic upgrade head
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_entrypoint.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Wire the entrypoint into the Dockerfile**

In `backend/Dockerfile`, replace lines 19-30 with:

```dockerfile
RUN adduser --system --no-create-home --group --uid 1000 app \
    && mkdir -p /app/data/uploads \
    && chmod +x /app/entrypoint.sh \
    && chown -R app:app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

CMD ["/app/entrypoint.sh"]
```

Rationale: `chmod +x` makes the script runnable; `exec` inside it makes uvicorn PID 1 so Render's SIGTERM triggers graceful shutdown; the HEALTHCHECK now honors `$PORT` for local/Render parity.

- [ ] **Step 6: Build the image to confirm it is valid**

Run: `cd backend && docker build -t crux-api-test .`
Expected: build succeeds through the `CMD` layer with no error.

- [ ] **Step 7: Commit**

```bash
git add backend/entrypoint.sh backend/Dockerfile backend/tests/test_entrypoint.py
git commit -m "feat(deploy): container entrypoint migrates, binds \$PORT, execs uvicorn"
```

---

### Task 3: Render Blueprint (`render.yaml`)

Declares the backend web service as code so it is reproducible and reviewable.

**Files:**
- Create: `render.yaml` (repo root)
- Test: `backend/tests/test_deploy_config.py` (render portion)

**Interfaces:**
- Produces: `render.yaml` with one `web` service, `runtime: docker`, `healthCheckPath: /health`, `plan: free`, and secret env vars declared `sync: false`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_deploy_config.py`:

```python
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RENDER = REPO_ROOT / "render.yaml"


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
    for secret in ("GEMINI_API_KEY", "DATABASE_URL", "SUPABASE_SECRET_KEY", "CORS_ORIGINS"):
        assert env_vars[secret].get("sync") is False
        assert "value" not in env_vars[secret]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_deploy_config.py -v`
Expected: FAIL (render.yaml missing → `FileNotFoundError`)

- [ ] **Step 3: Create `render.yaml`**

Create `render.yaml` at the repo root:

```yaml
services:
  - type: web
    name: crux-api
    runtime: docker
    dockerfilePath: ./backend/Dockerfile
    dockerContext: ./backend
    plan: free
    # Set region to match the Supabase project region to avoid cross-region latency.
    region: singapore
    healthCheckPath: /health
    envVars:
      - key: ENV
        value: prod
      - key: LLM_STUB
        value: "false"
      - key: EMBEDDING_DIM
        value: "768"
      - key: DAILY_CAP
        value: "50"
      - key: LLM_SOFT_CAP_USD
        value: "2.00"
      - key: LLM_HARD_CAP_USD
        value: "3.00"
      - key: GEMINI_API_KEY
        sync: false
      - key: DATABASE_URL
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_PUBLISHABLE_KEY
        sync: false
      - key: SUPABASE_SECRET_KEY
        sync: false
      - key: CORS_ORIGINS
        sync: false
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_deploy_config.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add render.yaml backend/tests/test_deploy_config.py
git commit -m "feat(deploy): render blueprint for backend web service"
```

---

### Task 4: Vercel config (`frontend/vercel.json`)

SPA rewrite so Vue Router deep links work, plus the security header block (CSP's only home now that there is no nginx).

**Files:**
- Create: `frontend/vercel.json`
- Test: `backend/tests/test_deploy_config.py` (extend with vercel portion)

**Interfaces:**
- Produces: `frontend/vercel.json` with a catch-all rewrite to `/index.html` and a `headers` block containing a `Content-Security-Policy`.

- [ ] **Step 1: Write the failing test (extend the deploy-config test)**

Append to `backend/tests/test_deploy_config.py`:

```python
import json

VERCEL = REPO_ROOT / "frontend" / "vercel.json"


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_deploy_config.py -k vercel -v`
Expected: FAIL (vercel.json missing → `FileNotFoundError`)

- [ ] **Step 3: Create `frontend/vercel.json`**

Create `frontend/vercel.json`. The CSP `connect-src` must list the Supabase origin and the Render API origin; the API origin is unknown until the backend is deployed, so it is filled in during the runbook (a placeholder host is committed and swapped later):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; connect-src 'self' https://*.supabase.co https://CRUX_API_HOST; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

Note: `https://CRUX_API_HOST` is a literal placeholder swapped for the real Render host in runbook step 6. `style-src 'unsafe-inline'` is required by PrimeVue/KaTeX inline styles. The CSP must be verified in the live smoke (runbook step 7) so it does not break the app.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_deploy_config.py -k vercel -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Confirm the frontend build still succeeds**

Run: `cd frontend && npm run build`
Expected: build completes, `dist/` produced (vercel.json is config-only, does not affect local build)

- [ ] **Step 6: Commit**

```bash
git add frontend/vercel.json backend/tests/test_deploy_config.py
git commit -m "feat(deploy): vercel SPA rewrite + security headers"
```

---

### Task 5: Deploy runbook (`docs/deploy/RUNBOOK.md`)

The manual, dashboard-side procedure. Ordered to handle the first-migration risk (step 0) and the CORS/CSP chicken-egg (frontend URL and API host unknown until deployed).

**Files:**
- Create: `docs/deploy/RUNBOOK.md`

- [ ] **Step 1: Write the runbook**

Create `docs/deploy/RUNBOOK.md`:

```markdown
# Deploy Runbook — WS-C (Render + Vercel)

Manual, dashboard-side steps. Config-as-code lives in `render.yaml`,
`frontend/vercel.json`, and `backend/Dockerfile` + `backend/entrypoint.sh`.
Never commit a secret; enter secrets only in host dashboards.

## Step 0 — Pre-migration safety (do this first)

Migrations otherwise auto-run on the first container boot against live Supabase.
Run them deliberately and observed instead:

1. Confirm a Supabase restore point / backup exists (Supabase dashboard →
   Database → Backups). Do not proceed without one.
2. From `backend/` with prod `DATABASE_URL` exported locally, run
   `alembic upgrade head` and confirm it reaches the latest revision with no
   error. This also satisfies owed gate G1 (live migration 0011/0012).

## Step 1 — Prereqs

- Render account (free).
- Vercel account (Hobby) with **NO payment card on file**.

## Step 2 — Backend on Render

1. Render dashboard → New → Blueprint → connect this repo.
2. Render detects `render.yaml`. Confirm the service `crux-api`.
3. Confirm/adjust `region` to match your Supabase region.
4. When prompted for the `sync: false` env vars, paste:
   `GEMINI_API_KEY`, `DATABASE_URL` (Supabase Postgres connection string —
   the single most important value, NOT sqlite), `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
   Leave `CORS_ORIGINS` blank for now (set in step 6).
5. Deploy. Wait for the build + first boot (entrypoint runs `alembic upgrade
   head`, then uvicorn on `$PORT`).
6. Verify: open `https://<api>.onrender.com/health` → expect an ok response.

## Step 3 — Record the Render URL

Copy the service URL, e.g. `https://crux-api.onrender.com`.

## Step 4 — Frontend on Vercel

1. Vercel → Add New → Project → import this repo.
2. Set **Root Directory** to `frontend/`.
3. Framework preset: Vite (auto). Build/output come from `vercel.json`.
4. Add build env vars:
   - `VITE_API_BASE_URL` = the Render URL from step 3
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your Supabase publishable key
   - `VITE_CHAT_STREAM` = `true`
5. Deploy.

## Step 5 — Record the Vercel URL

Copy the deployment URL, e.g. `https://crux.vercel.app`.

## Step 6 — Resolve CORS + CSP (chicken-egg)

1. Render → `crux-api` → Environment → set `CORS_ORIGINS` = the Vercel URL
   from step 5 → save (triggers a redeploy).
2. In `frontend/vercel.json`, replace the `CRUX_API_HOST` placeholder in the
   CSP `connect-src` with the Render host (no scheme), commit, and let Vercel
   redeploy.

## Step 7 — Live smoke (owed gate)

Against the live Vercel URL: register, confirm email, log in, send a chat
message (tutor responds), upload a PDF. Open browser devtools and confirm no
CSP violations block the app. If the CSP blocks a needed origin, widen the
relevant directive in `vercel.json` and redeploy.

## Step 8 — Uploads caveat

Render free tier disk is ephemeral: uploaded PDFs are lost on restart / cold
start (~15 min idle). DB data on Supabase is safe. WS-D (R2) is the real fix.

## Step 9 — Rollback

- Render: Deploys tab → pick a previous successful deploy → Rollback.
- Vercel: Deployments → previous deployment → Promote to Production.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deploy/RUNBOOK.md
git commit -m "docs(deploy): render + vercel deploy runbook"
```

---

## Notes for the executor

- Tasks 1-4 are independent and each end green; Task 5 is documentation and
  depends on nothing in code. Any order works, but 1→5 is the natural sequence.
- No task deploys anything or touches a dashboard — that is the human operator's
  job via the runbook. This plan produces the config + code + runbook only.
- After all tasks: full `cd backend && pytest -q` and `cd frontend && npm run
  test:unit -- --run` must stay green before opening the PR to `dev`.

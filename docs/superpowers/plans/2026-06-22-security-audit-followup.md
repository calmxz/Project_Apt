# Security Audit Follow-Up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 open code findings from `docs/security/SECURITY_REVIEW_2026-06-22.md` (nginx CSP headers, JWT `iss` validation, prod-only JWKS fail-fast), document the branch-protection action item, and close the parser-CVE spot-check as clean.

**Architecture:** Three independent, small code changes (nginx config, two backend changes) bundled into one branch since none touch shared files. No new services, no schema changes.

**Tech Stack:** nginx (frontend container), FastAPI/PyJWT (backend), pytest (existing test infra in `backend/tests/test_auth_dependency.py`).

## Global Constraints

- Branch: `fix/security-audit-2026-06-22` off `dev`. One PR into `dev`.
- The JWKS fail-fast guard must be gated on `settings.env == "prod"` — it must NOT raise when `SUPABASE_URL` is unset in dev/test, since CI (`ci.yml` backend job) never sets `SUPABASE_URL` and `backend/tests/conftest.py`'s `client` fixture triggers `main.py`'s `lifespan()` on every test that uses it. An unconditional raise breaks the entire test suite.
- The JWT `iss` check changes the required claims on every token `services/auth.py` accepts. Existing tests in `backend/tests/test_auth_dependency.py` that build tokens via the `_sign()` helper must keep passing — this requires giving `_sign()` a default `iss` that matches what the test's patched `settings.supabase_url` will produce.
- No backend route, schema, or contract changes. No `docs/api/openapi.yaml` edit needed — skip `gen_contracts.py`.

---

### Task 1: nginx security headers + CSP

**Files:**
- Modify: `frontend/nginx.conf`

**Interfaces:** None — this is a config-only change, no code consumes/produces anything cross-task.

- [ ] **Step 1: Add security headers to the `server {}` block**

Read the current file first (`frontend/nginx.conf`) to find the `server {` block opening line, then add immediately after it:

```nginx
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

- [ ] **Step 2: Build the frontend and the nginx image**

```bash
cd frontend
npm run build
docker build -t adaptlearn-frontend-csp .
cd ..
```
Expected: both commands exit 0. The `docker build` produces an image tagged `adaptlearn-frontend-csp`.

- [ ] **Step 3: Run the image standalone and confirm headers are present**

```bash
docker run -d --name csp-test -p 8090:8080 adaptlearn-frontend-csp
sleep 1
curl -sI http://localhost:8090/ | grep -iE "content-security-policy|x-frame-options|x-content-type-options|referrer-policy|strict-transport-security"
```
Expected: all 5 headers appear in the output, each matching what was written in Step 1.

- [ ] **Step 4: Check for CSP violations on initial page load**

Use the browser automation tool to navigate to `http://localhost:8090/` and read the console for CSP violations (pattern: `Content Security Policy|Refused to`). The backend is not running, so `/api/*` calls will fail to resolve (nginx proxies to the `backend` hostname, which doesn't exist outside the compose network) — that's expected and not a CSP issue; only look for `Refused to load/execute/apply` style messages caused by the policy itself (script-src, style-src, connect-src blocking legitimate same-origin assets).

If no CSP violations appear: policy is clean, go to Step 6.

If violations appear: note exactly which directive and resource triggered it.

- [ ] **Step 5: Adjust policy if needed, rebuild, recheck**

If Step 4 found violations, edit the `Content-Security-Policy` line in `frontend/nginx.conf` to address them (e.g. widen `style-src`/`script-src` for the specific blocked resource — do not widen further than the specific violation requires), then:

```bash
docker stop csp-test && docker rm csp-test
cd frontend && docker build -t adaptlearn-frontend-csp . && cd ..
docker run -d --name csp-test -p 8090:8080 adaptlearn-frontend-csp
```

Repeat Step 4 until the console is clean.

- [ ] **Step 6: Clean up the test container**

```bash
docker stop csp-test && docker rm csp-test
docker image rm adaptlearn-frontend-csp
```

- [ ] **Step 7: Commit**

```bash
git add frontend/nginx.conf
git commit -m "fix(security): add CSP and security headers to nginx"
```

Note for the PR description: full live-flow CSP verification (real login via Supabase, chat, upload) is out of scope for this local check — it folds into the already-owed live-Supabase smoke test from PR #85/#86.

---

### Task 2: JWT `iss` claim verification

**Files:**
- Modify: `backend/services/auth.py`
- Modify: `backend/tests/test_auth_dependency.py`

**Interfaces:**
- Consumes: `settings.supabase_url` (`backend/config.py:30`, already exists, type `str`).
- Produces: `verify_supabase_jwt(token: str) -> str` keeps its existing signature; now additionally rejects tokens with a missing or mismatched `iss` claim, raising `HTTPException(401, detail="invalid_token")` — same exception type/shape callers already handle.

- [ ] **Step 1: Add a fixed test issuer and patch `settings.supabase_url` in the test file**

In `backend/tests/test_auth_dependency.py`, add near the top (after the existing imports, before `rsa_keys` fixture):

```python
TEST_SUPABASE_URL = "https://test-project.supabase.co"
```

Then modify the `patch_jwks_client` fixture (currently lines 41-65) to also patch the URL:

```python
@pytest.fixture(autouse=True)
def patch_jwks_client(monkeypatch, rsa_keys):
    """Stub _get_jwks_client so signing-key lookup returns our test public key.

    Also resets the module-level cache so a prior test's stub doesn't leak,
    and pins settings.supabase_url so the iss check has a stable value to
    validate against.
    """
    auth_module._JWKS_CACHE["client"] = None
    auth_module._JWKS_CACHE["fetched_at"] = 0.0
    monkeypatch.setattr(auth_module.settings, "supabase_url", TEST_SUPABASE_URL)

    class _FakeSigningKey:
        def __init__(self, key):
            self.key = key

    class _FakeJWKSClient:
        def __init__(self, public_key):
            self._public_key = public_key

        def get_signing_key_from_jwt(self, _token):
            return _FakeSigningKey(self._public_key)

    monkeypatch.setattr(
        auth_module,
        "_get_jwks_client",
        lambda: _FakeJWKSClient(rsa_keys["public_key"]),
    )
```

- [ ] **Step 2: Give `_sign()` a default `iss` matching `TEST_SUPABASE_URL`**

Replace the existing `_sign()` helper (currently lines 68-79):

```python
def _sign(rsa_keys: dict, *, sub: str = "user-123", aud: str = "authenticated",
          exp_offset: int = 3600, iss: str | None = None,
          extra: dict | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "aud": aud,
        "iss": iss if iss is not None else f"{TEST_SUPABASE_URL}/auth/v1",
        "iat": now,
        "exp": now + exp_offset,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, rsa_keys["private_pem"], algorithm="RS256")
```

- [ ] **Step 3: Write the failing test for a wrong issuer**

Add after `test_wrong_audience_returns_401` (currently ends around line 138):

```python
def test_wrong_issuer_returns_401(client, rsa_keys):
    token = _sign(rsa_keys, iss="https://attacker.example.com/auth/v1")
    r = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_token"
```

- [ ] **Step 4: Run the full auth test file to confirm the new test fails and nothing else breaks yet**

Run: `cd backend && pytest tests/test_auth_dependency.py -v`
Expected: `test_wrong_issuer_returns_401` FAILS (token currently accepted, no iss check yet). All other tests in the file still PASS (the `_sign()` default `iss` doesn't matter yet since production code doesn't check it).

- [ ] **Step 5: Implement the `iss` check**

In `backend/services/auth.py`, replace the `jwt.decode` call inside `verify_supabase_jwt` (currently lines 48-54):

```python
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            options={"verify_aud": True, "verify_exp": True, "verify_iss": True},
        )
```

- [ ] **Step 6: Run the full auth test file again**

Run: `cd backend && pytest tests/test_auth_dependency.py -v`
Expected: all tests PASS, including `test_wrong_issuer_returns_401`.

- [ ] **Step 7: Run the full backend test suite to check for unrelated regressions**

Run: `cd backend && pytest -v`
Expected: all tests PASS. (Other test files use `app.dependency_overrides[current_user_id]` per `conftest.py`, bypassing `verify_supabase_jwt` entirely, so they're unaffected by this change — this run just confirms that assumption holds.)

- [ ] **Step 8: Commit**

```bash
git add backend/services/auth.py backend/tests/test_auth_dependency.py
git commit -m "fix(security): verify JWT iss claim against configured Supabase URL"
```

---

### Task 3: prod-only JWKS/Supabase-config fail-fast at startup

**Files:**
- Modify: `backend/main.py`
- Create: `backend/tests/test_main_lifespan.py`

**Interfaces:**
- Consumes: `settings.env` (`backend/config.py:28`, default `"dev"`), `settings.supabase_url` (`backend/config.py:30`).
- Produces: `lifespan(app)` (existing `@asynccontextmanager` function in `main.py`) now raises `RuntimeError` synchronously on `__aenter__` when `settings.env == "prod"` and `settings.supabase_url` is empty, instead of starting cleanly. No signature change — still `async def lifespan(app: FastAPI)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_main_lifespan.py`:

```python
"""Lifespan startup guard: prod must not boot without SUPABASE_URL configured.

Dev/test must NOT be affected — CI's backend job and the `client` fixture in
conftest.py never set SUPABASE_URL, and both rely on lifespan() completing
without raising.
"""
import pytest

import main as main_module
from config import settings


@pytest.mark.asyncio
async def test_prod_without_supabase_url_raises(monkeypatch):
    monkeypatch.setattr(settings, "env", "prod")
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(main_module, "create_tables", lambda: None)

    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        async with main_module.lifespan(main_module.app):
            pass


@pytest.mark.asyncio
async def test_dev_without_supabase_url_does_not_raise(monkeypatch):
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(main_module, "create_tables", lambda: None)

    async with main_module.lifespan(main_module.app):
        pass


@pytest.mark.asyncio
async def test_prod_with_supabase_url_does_not_raise(monkeypatch):
    monkeypatch.setattr(settings, "env", "prod")
    monkeypatch.setattr(settings, "supabase_url", "https://real-project.supabase.co")
    monkeypatch.setattr(main_module, "create_tables", lambda: None)

    async with main_module.lifespan(main_module.app):
        pass
```

`pytest-asyncio` is already a dev dependency (`backend/pyproject.toml`) with `asyncio_mode = "auto"`; `@pytest.mark.asyncio` matches the existing convention used in `tests/test_cost_cap.py`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_main_lifespan.py -v`
Expected: `test_prod_without_supabase_url_raises` FAILS (no guard exists yet — lifespan currently never raises). The other two tests PASS already (current behavior already doesn't raise).

- [ ] **Step 3: Implement the guard**

In `backend/main.py`, replace the `lifespan` function (currently lines 11-14):

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.env == "prod" and not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required when ENV=prod")
    create_tables()
    yield
```

- [ ] **Step 4: Run to verify all 3 pass**

Run: `cd backend && pytest tests/test_main_lifespan.py -v`
Expected: all 3 PASS.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && pytest -v`
Expected: all tests PASS, including everything in `conftest.py`'s `client`-fixture-based tests (these run with `settings.env` at its default `"dev"`, so the new guard never triggers for them).

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_main_lifespan.py
git commit -m "fix(security): fail fast at startup when SUPABASE_URL is unset in prod"
```

---

### Task 4: Close out the doc-only findings

**Files:**
- Modify: `docs/security/SECURITY_REVIEW_2026-06-22.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add the parser spot-check as a closed, clean item**

Add a new subsection right before the "## 4. Still-open, not new" heading:

```markdown
### PDF/PPTX parser spot-check — closed, no fix needed

Reviewed `backend/services/ingestion_service.py` and `backend/lib/chunking.py`. `pypdf`/`python-pptx` are covered by `pip-audit` in CI; every extraction call runs inside `run()`'s top-level `try/except Exception`, which marks the document `failed` without crashing or leaking internals; resource-exhaustion risk is bounded by the existing 25MB upload cap (`upload.py:29`). No code change.
```

- [ ] **Step 2: Add the branch-protection checklist**

Add this under "## 4. Still-open, not new", replacing the existing one-line bullet about branch protection:

```markdown
- **Branch protection / required status checks** — never applied (confirmed via CLAUDE.md's own Phase 6 status note). Manual steps for whoever has admin on the repo, in GitHub → Settings → Branches → Add branch protection rule for `main`:
  1. Branch name pattern: `main`
  2. Check "Require a pull request before merging"
  3. Check "Require status checks to pass before merging", then check "Require branches to be up to date before merging"
  4. Search for and select each of these as required: `Backend (pytest)`, `Frontend (Vitest + lint)`, `Security (SAST + deps + secrets + images)`, `Analyze (python)`, `Analyze (javascript-typescript)`
  5. Check "Require signed commits"
  6. Save changes
```

- [ ] **Step 3: Commit**

```bash
git add docs/security/SECURITY_REVIEW_2026-06-22.md
git commit -m "docs: close parser spot-check, add branch-protection checklist"
```

---

### Task 5: Open the PR

**Files:** None — branch/PR operation only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/security-audit-2026-06-22
```

- [ ] **Step 2: Open the PR into dev**

```bash
gh pr create --base dev --title "fix(security): close 2026-06-22 audit follow-up findings" --body "$(cat <<'EOF'
## Summary
- nginx: add CSP + security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS)
- backend: verify JWT `iss` claim against configured Supabase URL
- backend: fail fast at startup if SUPABASE_URL is unset when ENV=prod (dev/test unaffected)
- docs: close PDF/PPTX parser spot-check as clean, add branch-protection click-through checklist

See docs/security/SECURITY_REVIEW_2026-06-22.md for full findings and docs/superpowers/specs/2026-06-22-security-audit-followup-design.md for the design.

## Test plan
- [ ] `pytest` (backend) green, including new `test_wrong_issuer_returns_401` and `test_main_lifespan.py`
- [ ] CSP verified locally: headers present via curl, no console violations on initial page load (Task 1)
- [ ] Branch protection checklist applied manually post-merge (not part of this PR's diff)
- [ ] iss format confirmed at the already-owed live-Supabase smoke test (PR #85/#86)
EOF
)"
```

Expected: PR created, URL printed. Report the URL back to the user.

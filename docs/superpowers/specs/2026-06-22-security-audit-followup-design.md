# Security Audit Follow-Up Fixes — Design

Date: 2026-06-22
Status: Approved
Source: `docs/security/SECURITY_REVIEW_2026-06-22.md` (3 new findings) + this session's parser spot-check

## Scope

Close all open items from the 2026-06-22 security audit addendum:

1. Missing CSP / security headers in `frontend/nginx.conf` (Medium)
2. JWT `iss` claim not verified in `backend/services/auth.py` (Low)
3. JWKS client misconfiguration returns 500 instead of failing fast at startup (Info)
4. Branch protection / required status checks never applied (repo-settings, not code)
5. PDF/PPTX parser CVE spot-check (`ingestion_service.py`, `lib/chunking.py`)

Out of scope: Phase 8 deploy architecture (Fly.io vs nginx vs CDN) — explicitly deferred per this session's clarifying question; nginx stays as-is for now.

## 5 — Parser spot-check: closed, no fix needed

Reviewed `backend/services/ingestion_service.py` and `backend/lib/chunking.py`.

- `pypdf.PdfReader` and `pptx.Presentation` are both maintained libraries already covered by `pip-audit` in CI for known CVEs.
- Every extraction call happens inside `run()`'s top-level `try/except Exception`, which sets `doc.status = "failed"`, `doc.error = str(e)[:1000]`, and commits — no crash propagation, no cross-user error leakage (this background task runs per-document, not per-request).
- Resource-exhaustion risk (decompression bombs, deeply nested objects) is bounded by the existing `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` cap in `upload.py` — not eliminated in theory, but the practical blast radius is one background task with a bounded input size, not a request-thread DoS.
- `chunking.py` only runs `tiktoken` encode/decode over text already extracted and size-bounded upstream. No independent attack surface.

**Action:** add a line to `SECURITY_REVIEW_2026-06-22.md`'s "checked and clean" list. No code change.

## 1 — nginx CSP / security headers

**File:** `frontend/nginx.conf`

Add to the `server {}` block:

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

**Verification (required before merge, not optional):**
1. `cd frontend && npm run build`
2. Build/run the nginx image locally (`docker build` + `docker run`, or `docker compose up frontend` against the built dist).
3. Load the app in a browser, exercise the main flows (login, chat, upload, settings).
4. Check the browser console for CSP violation reports.
5. Adjust the policy (most likely candidate: `style-src` tightening/loosening for PrimeVue, `connect-src` for the exact Supabase project host) until the console is clean on all exercised flows.
6. Record the final, verified policy in this file before the PR is opened — if it differs from the draft above, update this section.

## 2 — JWT `iss` claim verification

**File:** `backend/services/auth.py`

Current:
```python
payload = jwt.decode(
    token,
    signing_key,
    algorithms=["RS256", "ES256"],
    audience="authenticated",
    options={"verify_aud": True, "verify_exp": True},
)
```

New:
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

Assumes Supabase's documented issuer format `<project_url>/auth/v1`. This is not independently confirmed against a real token in this session — it will be confirmed during the live-Supabase smoke test already owed from PR #85/#86 (see `[[project_email_password_auth_smoke]]`). If the real `iss` claim differs from this format, the smoke test will surface it as a 401 on an otherwise-valid login, and the format string gets corrected then.

**Test:** unit test with a forged/mocked token carrying a wrong `iss` value — assert `verify_supabase_jwt` raises `HTTPException(401)`. Existing JWKS-mocking pattern in the current auth test file should already provide the scaffolding for this.

## 3 — JWKS client fail-fast at startup (prod only)

**File:** `backend/main.py`, inside `lifespan()`

Correction from the initial audit write-up: an unconditional startup crash on missing `SUPABASE_URL` would break every test — `backend/tests/conftest.py`'s `client` fixture imports `main.app` and triggers `lifespan()` via `with TestClient(app) as c:`, and the CI backend job (`ci.yml`) never sets `SUPABASE_URL` (tests run on sqlite + LLM stub by design). The existing per-request 500 in `services/auth.py` (`detail="auth_not_configured"`) is also not a crash — it's already a controlled, already-tested response (`test_auth_not_configured_when_jwks_url_missing`). The actual gap is narrower: a **prod** deploy with a missing `SUPABASE_URL` silently accepts traffic and 500s on the first real request instead of refusing to start.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.env == "prod" and not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is required when ENV=prod")
    create_tables()
    yield
```

Gated on `settings.env == "prod"` so dev/test/CI (which never set `ENV=prod`) are unaffected. The existing per-request 500 path in `auth.py` is untouched — it remains the dev/test-time behavior when `SUPABASE_URL` is blank.

**Test:** call `lifespan()` directly in a test with `monkeypatch.setattr(settings, "env", "prod")` and `monkeypatch.setattr(settings, "supabase_url", "")`, assert it raises `RuntimeError`. Also assert it does NOT raise when `env="dev"` and `supabase_url=""` (regression guard for the existing test suite).

## 4 — Branch protection (repo settings, not code)

Written as a checklist in `SECURITY_REVIEW_2026-06-22.md` for the user to apply manually in GitHub Settings → Branches → `main`:

- Require status checks to pass before merging: `Backend (pytest)`, `Frontend (Vitest + lint)`, `Security (SAST + deps + secrets + images)`, `Analyze (python)`, `Analyze (javascript-typescript)`
- Require branches to be up to date before merging
- Require signed commits on `main`

No code or PR needed for this — it's a settings change. The implementation plan should NOT attempt to script this via `gh api`; document it as a manual action item with exact steps.

## Branching / PR strategy

One branch off `dev`: `fix/security-audit-2026-06-22`. Bundles findings 1-3 (code) + the doc update for findings 4-5 (no code). One PR into `dev` — these are small, thematically one unit (closing the audit addendum), and none of the 3 code changes touch shared files with each other, so splitting into 3 PRs adds review overhead without isolation benefit.

## Testing summary

| Finding | Test |
|---|---|
| 1 (CSP) | Manual: local build + browser console check, no CSP violations on main flows |
| 2 (`iss`) | New unit test: wrong-issuer token → 401 |
| 3 (fail-fast) | New unit test: missing `SUPABASE_URL` → raises at startup |
| 4 (branch protection) | N/A — manual GitHub settings, no test |
| 5 (parser) | N/A — closed by review, no code change |

## Open question carried forward (not blocking)

The exact Supabase `iss` format is assumed, not confirmed, pending the already-owed live smoke test. If it's wrong, the fix is a one-line string change in `auth.py`, not a design change.

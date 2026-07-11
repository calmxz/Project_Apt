# Security Review Addendum — 2026-06-22

Follow-up audit against current `dev` (post Phase 7: Supabase Auth + Postgres/pgvector, post chat redesign, post PR #86 password-reset). Builds on `SECURITY_REVIEW.md` (2026-05-23) and `SECURITY_FIXPLAN.md`, both written against a pre-auth, ChromaDB-based build. This doc does three things: (1) confirms the old fixes still hold, (2) corrects two claims in the old docs that the Phase 7 migration made false, (3) lists new findings discovered in this pass, each with a fix.

## 1. Old audit re-verified against current code

All 12 findings in `SECURITY_REVIEW.md` (H-1–H-5, M-1–M-5, L-1–L-2) were independently re-checked by reading the current code, not just trusting the old "Resolved" column:

| ID | Claim | Re-verified in |
|---|---|---|
| H-1..H-5 | Ownership checks, IDOR closure, generic 404s | `sessions.py`, `upload.py`, `profile.py`, `chat.py`, `tools.py` dispatch override — every session/document/profile route still checks `row.user_id != user_id → 404` |
| M-4 | Backend container non-root | `backend/Dockerfile` — `USER app` (uid 1000), confirmed |
| M-x | Frontend container non-root | `frontend/Dockerfile` — `USER nginx`, confirmed |
| M-x | Filename sanitization | `upload.py:84` — `re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)`, confirmed |
| M-x | Generic upstream error messages | `retrieval_service.py:53-59` — catches `Exception`, logs internally, returns `"retrieval_failed"` to caller, confirmed |
| L-x | LLM cost cap | `cost_meter.check_cap()` checked every loop iteration in `tutor.py`, both streaming and non-streaming paths — confirmed, and this is *stronger* than the original fix plan since it closes a multi-tool-call cost-evasion gap |

**Verdict: all 12 are still fixed.** No regressions found.

## 2. Corrections to the old docs (now stale, not new bugs)

### 2.1 "No API token stored anywhere" — now false

`SECURITY_REVIEW.md`'s "Checked and clean" section says this. It was true on 2026-05-23 (no real auth yet — `localStorage userId` only). Phase 7 added Supabase Auth. Current state:

- `frontend/src/services/supabase.js:23-29` — `createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })`. Supabase JS SDK stores access + refresh JWTs in `localStorage` under this config.
- `frontend/src/stores/auth.js:22` — `accessToken` computed exposes `session.value?.access_token`, used by the API client to set the `Authorization` header.

This is **not a defect by itself** — it's the standard Supabase SPA pattern, and the backend independently verifies every JWT server-side (`services/auth.py`) rather than trusting anything the client claims. But it does change the threat model: an XSS bug anywhere on the page now has a path to read the token directly out of `localStorage`. See Finding 1 below for the mitigating control that's currently missing.

### 2.2 ChromaDB references — architecturally obsolete

`SECURITY_REVIEW.md` and `CI_INVENTORY.md` reference `chroma_client.py` and per-session Chroma collections. Phase 7 T4 replaced this with pgvector on Supabase Postgres (`backend/services/pgvector_store.py`, `chunk_embeddings` table). Retrieval is now `backend/services/retrieval_service.py`, confirmed read this pass — same security properties carried forward (session-scoped query, `args.session_id != ctx.session_id` hard guard at `retrieval_service.py:23-28`, generic error on failure). Any test or doc that still says "chroma" in its name (e.g. `test_chroma_exception_does_not_leak_internal_message`) is a naming artifact, not a live gap — the behavior it tests still exists, just against pgvector now.

## 3. New findings this pass

### Finding 1 — No security headers on the frontend (nginx) — MEDIUM

`frontend/nginx.conf` (47 lines, full file) sets no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Observer` — sorry, `X-Content-Type-Options`, `Referrer-Policy`, or `Strict-Transport-Security`. Combined with §2.1 (JWT now lives in `localStorage`), this is the single highest-value fix in this addendum: a CSP is the main control that limits what an XSS payload can do once injected, including reaching `localStorage`.

**Fix** — add to the `server {}` block in `frontend/nginx.conf`:

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

Notes:
- `connect-src` must allow the Supabase project domain (`*.supabase.co`) since the SPA talks to Supabase Auth directly from the browser.
- `style-src 'unsafe-inline'` is likely needed for PrimeVue/Vite-injected styles — verify in a dev build before tightening further; don't ship a CSP that's broken vs. one that's perfect.
- HSTS only matters once TLS termination is confirmed at the edge (Fly.io / reverse proxy in front of this nginx) — harmless to ship now, just confirm it's actually serving over HTTPS in Phase 8 deploy.

**Status update (2026-07-11): Fixed.** The remedy moved from `frontend/nginx.conf`
(stale — WS-C moved the deploy to Vercel + Render) to `frontend/vercel.json`
`headers`: Content-Security-Policy (default-src 'self', frame-ancestors 'none',
object-src 'none', base-uri 'self'), X-Content-Type-Options, X-Frame-Options,
and Referrer-Policy, shipped in WS-C. The `CRUX_API_HOST` placeholder in
`connect-src` is substituted at deploy time per `docs/deploy/RUNBOOK.md` step 2
of the frontend section. Live curl verification of the deployed headers remains
an open human gate (slice 7 PR body).

### Finding 2 — JWT `iss` claim not verified — LOW (carried over, independently re-confirmed)

`backend/services/auth.py` — `jwt.decode(..., options={"verify_aud": True, "verify_exp": True})`. No `verify_iss` / no `issuer=` argument. A token signed by the correct Supabase project key but for a *different* `iss` (e.g. a different Supabase project sharing infra, in a pathological misconfiguration) would still pass. Low severity because `aud="authenticated"` plus JWKS-pinned signing key already do the heavy lifting — this is defense-in-depth, not a live exploit path under the current single-project setup.

**Fix** — in `services/auth.py`, add the expected issuer and verify it:

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

Verify the exact `iss` format against a real token first (decode one at jwt.io or via `jwt.decode(token, options={"verify_signature": False})`) — Supabase's issuer string format should match `<project_url>/auth/v1` but confirm before hardcoding.

**Status update (2026-07-06): Fixed.** Implemented exactly as above at `backend/services/auth.py:53-54` (`issuer=f"{settings.supabase_url}/auth/v1"` with `"verify_iss": True`), re-verified by reading the current code this pass.

### Finding 3 — JWKS-client misconfiguration returns 500, not 401 — INFO

`services/auth.py`'s `_get_jwks_client()` raises an unhandled error (→ FastAPI 500) when `SUPABASE_URL` is unset, instead of a clean 401/503. Not attacker-reachable (it's a deployment misconfig, not a per-request condition), but worth a guard clause so a bad deploy fails loudly and clearly rather than 500ing every request with a generic trace.

**Fix** — fail fast at startup instead of per-request:

```python
# config.py or main.py startup
if not settings.supabase_url:
    raise RuntimeError("SUPABASE_URL is required")
```

**Status update (2026-07-11): Fixed.** `services/auth.py` now exposes
`validate_jwks_startup()`, called from the `main.py` lifespan: when
`supabase_jwks_url` is configured, the JWK set is fetched at startup and any
failure raises `RuntimeError`, so misconfiguration kills boot instead of
returning per-request 500s. Commit `53c6f32`.

### Finding 4 — `v-html` sink confirmed single and sanitized — informational, closes a check

`frontend/src/components/chat/MarkdownContent.vue:22` is the **only** `v-html`/`innerHTML` sink in the frontend (`grep -rn "v-html|innerHTML|dangerouslySetInnerHTML" frontend/src` returns exactly one hit). Per `[[project_katex_plugin_swap]]` this renders through `markdown-it` + DOMPurify (`safeHtml`), not raw model output. No new finding — recorded here because the old audit predates the chat redesign that introduced this rendering path, so it had never been checked against the current renderer until now.

### PDF/PPTX parser spot-check — closed, no fix needed

Reviewed `backend/services/ingestion_service.py` and `backend/lib/chunking.py`. `pypdf`/`python-pptx` are covered by `pip-audit` in CI; every extraction call runs inside `run()`'s top-level `try/except Exception`, which marks the document `failed` without crashing or leaking internals; resource-exhaustion risk is bounded by the existing 25MB upload cap (`upload.py:29`). No code change.

### Finding 5 — `document_excerpt` delimiter forgery (S1) — MEDIUM (added 2026-07-06, Fixed)

Text inside an uploaded document could contain the excerpt-block delimiter string, letting a hostile PDF forge or break out of the retrieved-excerpt framing injected into the tutor prompt. **Fixed 2026-07-06** — delimiter escaping in `backend/agent/excerpt.py` (slice 1, S1).

### Finding 6 — check/complete rate-limit bypass (S2) — MEDIUM (added 2026-07-06, Fixed)

The check-question complete path could be driven repeatedly without being counted against the per-user rate limit, bypassing the throttle that gates other LLM-backed turns. **Fixed 2026-07-06** — bypass closed in `backend/routes/sessions.py` (slice 1, S2).

## 4. Still-open, not new

- **Branch protection / required status checks** — never applied (confirmed via CLAUDE.md's own Phase 6 status note). Manual steps for whoever has admin on the repo, in GitHub → Settings → Branches → Add branch protection rule for `main`:
  1. Branch name pattern: `main`
  2. Check "Require a pull request before merging"
  3. Check "Require status checks to pass before merging", then check "Require branches to be up to date before merging"
  4. Search for and select each of these as required: `Backend (pytest)`, `Frontend (Vitest + lint)`, `Security (SAST + deps + secrets + images)`, `Analyze (python)`, `Analyze (javascript-typescript)`
  5. Check "Require signed commits"
  6. Save changes
- **CI tool inventory unchanged** — re-grepped `.github/workflows/`: `gitleaks` (ci.yml, full-history secret scan), `npm audit --omit=dev --audit-level=high`, and `codeql.yml` (separate workflow file) are all still present and wired up, alongside the previously-confirmed bandit/semgrep/pip-audit/hadolint/trivy. All 8 tools from `CI_INVENTORY.md` are still active — no drift here.

## 5. Summary table

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | No CSP / security headers on the frontend | Medium | **Fixed (2026-07-11) — `frontend/vercel.json` headers; live curl verify owed** |
| 2 | JWT `iss` not verified | Low | **Fixed (2026-07-06) — `backend/services/auth.py:53-54`** |
| 3 | JWKS misconfig → 500 instead of fail-fast | Info | **Fixed (2026-07-11) — `validate_jwks_startup()` in `services/auth.py`** |
| 4 | `v-html` sink — confirmed single, sanitized | Info | Closed (no action) |
| 5 | `document_excerpt` delimiter forgery (S1) | Medium | **Fixed (2026-07-06) — `backend/agent/excerpt.py`** |
| 6 | check/complete rate-limit bypass (S2) | Medium | **Fixed (2026-07-06) — `backend/routes/sessions.py`** |
| — | All 12 findings from 2026-05-23 audit | — | Confirmed still resolved |
| — | "No token stored" claim | — | Corrected (now stores Supabase JWT in localStorage, by design, needs Finding 1's CSP as mitigation) |
| — | ChromaDB references in old docs | — | Corrected (architecturally replaced by pgvector, Phase 7 T4) |
| — | Branch protection / required checks | — | Still not applied — repo-settings action, owner: user |

Fix history: **1 → 3** — both fixed in slice 7 (2026-07-11, S3.1/S3.3). Findings 2, 5, and 6 shipped previously fixed.

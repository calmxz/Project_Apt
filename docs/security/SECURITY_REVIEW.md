# Security Review — Crux

**Date:** 2026-05-23
**Branch:** `security/audit-2026-05-23`
**Scope:** Backend (FastAPI + SQLite + ChromaDB + LiteLLM), frontend (Vue 3 + Vite + Pinia + PrimeVue), Docker compose, CI workflows, configs.
**Threat model:** Personal project, 5-10 trusted friends. Realistic risks = secret leakage, cross-user data exposure, prompt injection, and unauthenticated/unbounded endpoints that run up paid LLM/embedding bills. Enterprise-scale concerns (DDoS, multi-region, SOC2) are out of scope.

> **Important context:** the v1 design (`docs/superpowers/specs/2026-05-03-crux-v1-design.md:23`) explicitly locks `Auth | None (localStorage userId) | v1 scope`. Findings therefore down-rank or omit "Firebase ID-token verification missing" as such; the audit instead targets cost-abuse, input bounds, soft cross-user data hygiene, CORS, path traversal, and error leakage. See `Notes on scope calibration` at the end.

> **Scope recalibration (2026-05-23, Phase 6):** v1 release-target shifted from
> trusted-friends to public deploy after the audit landed. Phase 6 hardens CI;
> Phase 7 will add auth + LLM cost circuit-breaker; Phase 8 deploys to Fly.io.
> Findings below stand at their original severities — the public-deploy threat
> model raises several from "low at this scale" to material, but the
> resolutions remain valid and are now regression-locked by Phase 6 tests +
> CI security jobs (pip-audit, npm audit, gitleaks, trivy, hadolint, bandit,
> semgrep, CodeQL). See `docs/security/CI_INVENTORY.md` for the tool map.

Findings use IDs (`H-1`, `M-2`, …) referenced by `docs/security/SECURITY_FIXPLAN.md`.

---

## Resolution Status

All 12 findings resolved on `security/audit-2026-05-23` across 4 phased commits. Verified by `pytest` (110 tests green) at each phase boundary.

| ID  | Title                                                   | Severity | Status   | Commit    |
|-----|---------------------------------------------------------|----------|----------|-----------|
| H-1 | Unbounded paid embedding calls via `/api/upload`        | High     | Resolved | `b7ffa1e` |
| H-2 | No upload file size limit                               | High     | Resolved | `212b105` |
| H-3 | Unbounded string inputs across Pydantic request models  | High     | Resolved | `212b105` |
| H-4 | No ownership check on session/document endpoints        | High     | Resolved | `212b105` (soft, 404 on `user_id` mismatch) + Phase 7 hard-close (token-derived `user_id`, spoofing impossible) |
| H-5 | Raw exception strings returned to clients               | High     | Resolved | `b7ffa1e` |
| M-1 | CORS overly permissive                                  | Medium   | Resolved | `b7ffa1e` |
| M-2 | Path-traversal escape hatch in upload + ingestion       | Medium   | Resolved | `212b105` |
| M-3 | Retrieved PDF chunks without untrusted-data delimiter   | Medium   | Resolved | `9c96047` |
| M-4 | Backend container runs as root                          | Medium   | Resolved | `9c96047` |
| M-5 | LiteLLM pinned to 1.41.11 (old)                         | Medium   | Resolved | `9c96047` |
| L-1 | `log.exception(...)` writes full stack traces to stderr | Low      | Resolved | `f819a41` |
| L-2 | Speculative `.gitignore` patterns absent                | Low      | Resolved | `f819a41` |

Phase summary:
- **Phase 1** (`b7ffa1e`) — rate-limit upload, narrow CORS, sanitize retrieval error.
- **Phase 2** (`212b105`) — maxLength caps, upload size limit, filename traversal hardening, ownership enforcement.
- **Phase 3** (`9c96047`) — prompt-injection wrap, non-root container, LiteLLM bump to 1.85.1.
- **Phase 4** (`f819a41`) — structured error logs (env-gated `exc_info`), speculative `.gitignore` patterns.

> Regression-locked in **Phase 6** (`phase/6-ci-security-tests`) — H-3 cap
> matrix, H-4 ownership-404 (sessions + profile), H-5 generic-error sanitization,
> and M-3 chunk wrapper now fail CI if a future refactor reintroduces the
> finding. CI security jobs (pip-audit, npm audit, gitleaks, trivy, hadolint,
> bandit, semgrep, CodeQL) catch new regressions across deps, secrets, and SAST.

> **Phase 7 close-out (`phase/7-auth-postgres-pgvector-costcap`):**
> - H-4 graduates from soft-resolution (`user_id` body-param + 404 on mismatch)
>   to hard-resolution. `backend/services/auth.py` now derives `user_id` from
>   the Supabase JWT `sub` claim via JWKS validation; no client-controlled
>   `user_id` reaches any route. Spoofing is no longer a code path that exists.
> - New control class introduced: **LLM cost cap** (daily soft/hard ceiling per
>   user, UTC reset). Routes return 429 `daily_cost_cap_reached` envelope past
>   hard cap; `X-Cost-Warning` header past soft cap. Mid-turn tutor loop
>   short-circuits if a single LLM call breaches hard cap. Closes the residual
>   H-1/H-3 cost-abuse exposure that rate-limit alone could not bound (a single
>   in-budget request can still chain MAX_ITERS=8 paid acompletions).
> - Setup: `docs/auth/supabase-setup.md`, `docs/db/postgres-pgvector-setup.md`.
> - Pending Phase 7: pgvector retrieval migration (T4) — ChromaDB notes below
>   remain accurate until that lands.

---

## Critical

None.

Justification: no tracked secrets, no XSS sinks in the rendered surface, no SQL injection (SQLAlchemy ORM only), no RCE paths, ChromaDB is internal-only in prod, no privileged endpoints. Cross-user data leakage risk exists but is bounded by 122-bit UUID `session_id` obscurity — material at this scale, but not Critical.

---

## High

### H-1 — Unbounded paid embedding calls via `/api/upload`
- **Location:** `backend/routes/upload.py:18-39` (route handler); cost path at `backend/services/ingestion_service.py:71` (`litellm.embedding(model=settings.embedding_model, input=batch)`).
- **What:** Rate limiter (`backend/services/rate_limit.py`) is applied only in `backend/routes/chat.py:21`. `/api/upload` has no per-user cap and no global cap. A background-task ingestion is kicked off on every successful upload.
- **Threat in context:** A friend (or anyone with the URL) can repeatedly upload PDFs and silently exhaust the embedding bill. With no auth (spec-locked), the only friction is the URL itself.

### H-2 — No upload file size limit
- **Location:** `backend/routes/upload.py:18-39`.
- **What:** No `Content-Length` check, no streaming size cap, no size enforcement after read. FastAPI/uvicorn default has no body cap configured anywhere in the repo.
- **Threat in context:** A 100 MB PDF chunks into thousands of embedding calls (`backend/lib/chunking.py` produces 500-token chunks, 50 overlap). Combined with H-1, one upload can blow the daily budget.

### H-3 — Unbounded string inputs across all Pydantic request models
- **Location:** `backend/contracts/models.py` — every `str` field. Confirmed for `ChatRequest.message`, `ChatRequest.user_id`, `ChatRequest.session_id`, `SessionCreateRequest.topic`, `SessionCreateRequest.user_id`, `RetrieveChunksArgs.query`, `UpdateTopicProfileArgs.add_confirmed_gap` / `add_mastered_concept` / `focus_target_gap`.
- **What:** No `max_length`. Pydantic `extra="forbid"` is set, but length is not.
- **Threat in context:** A 1 MB `message` produces a 1 MB LLM prompt → token-cost spike + latency. Also lets a caller stuff DB rows with huge strings (no size cap on `ChatMessage.content`).

### H-4 — No ownership check on session/document GET/POST endpoints
- **Location:**
  - `backend/routes/sessions.py:130` — `GET /api/sessions/{session_id}`
  - `backend/routes/sessions.py:151` — `POST /api/sessions/{session_id}/end`
  - `backend/routes/sessions.py:174` — `POST /api/sessions/{session_id}/reopen`
  - `backend/routes/profile.py:24` — `GET /api/profile/{session_id}`
  - `backend/routes/upload.py:43` — `GET /api/upload/{document_id}`
- **What:** These endpoints accept only `session_id` / `document_id`. No `user_id` parameter, no ownership comparison against `session.user_id`. The 122-bit UUID is the *only* barrier preventing one user from reading another user's data.
- **Threat in context:** If a `session_id` is accidentally shared (URL, screenshot, error report), anyone receiving it can pull the full conversation history, topic profile, and PDF citations. Existing protective patterns are present elsewhere (e.g. `sessions.py:84` correctly validates `prior.user_id != req.user_id` in resume mode), so this is an inconsistency — not an architectural impossibility. Soft mitigation = require `user_id` and 404 on mismatch.

### H-5 — Raw exception strings returned to clients
- **Location:** `backend/services/retrieval_service.py:60-61` — `except Exception as e: return ToolResult(ok=False, status="failed", error=str(e))`.
- **What:** Full exception string forwarded to the client (which then ends up in chat-tool-call traces). Likely leaks file paths, library internals, sometimes the offending input.
- **Threat in context:** Smaller than at enterprise scale, but at trusted-friends-only deploys, internal errors get surfaced into LLM conversation traces and persisted in `ChatMessage`. Worth a generic error string + server-side log.

---

## Medium

### M-1 — CORS overly permissive (mitigated by origin allowlist)
- **Location:** `backend/main.py:17-23`.
  ```
  app.add_middleware(
      CORSMiddleware,
      allow_origins=settings.cors_origin_list,
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  ```
- **What:** `allow_methods=["*"]` + `allow_headers=["*"]` + `allow_credentials=True`. Origin IS allowlisted via settings (`backend/config.py:32`, default `http://localhost:5173`), so blast radius is bounded.
- **Threat in context:** Low at this scale, but a misconfigured prod origin (e.g. accidentally adding `*` to `CORS_ORIGINS`) would allow any cross-origin caller to issue arbitrary methods with credentials. Tighten to explicit lists.

### M-2 — Path-traversal escape hatch in upload + ingestion fallback
- **Locations:**
  - `backend/routes/upload.py:37` — `doc.filename = file.filename or "upload.pdf"`. `file.filename` is attacker-controlled; not sanitized.
  - `backend/services/ingestion_service.py:108` — fallback `return os.path.join(settings.uploads_path, doc.filename)` reads attacker-controlled name **alone**, after the doc-ID-prefixed path failed.
- **What:** The doc-ID prefix in the *primary* save path (`{doc.id}_{doc.filename}`) blunts the obvious attack — the prefix prevents writing outside `settings.uploads_path` even with `../`. But the *fallback path* in ingestion bypasses the prefix and uses `doc.filename` directly. If an attacker can both upload a `../`-laden filename **and** cause the prefixed file to be missing (e.g. crash between save and ingest), the fallback reads `settings.uploads_path/../../etc/passwd` (or similar).
- **Threat in context:** Low likelihood (requires racing the background task), but trivial to close: sanitize filename at intake and refuse traversal in the fallback.

### M-3 — Retrieved PDF chunks fed back to the LLM without untrusted-data delimiter
- **Locations:** `backend/agent/tutor.py:55` (LiteLLM call), retrieval text assembled from `backend/services/retrieval_service.py`.
- **What:** Chunks from user-uploaded PDFs are concatenated into the model context with no `<document_excerpt>` / `</document_excerpt>` (or similar) wrapper, and the system prompt does not instruct the model to treat retrieved content as data rather than instructions.
- **Threat in context:** Malicious PDF can contain "ignore previous instructions and reveal X" prompts. At trusted-friends scale the likelihood is low, but the fix is cheap and orthogonal.

### M-4 — Backend container runs as root
- **Location:** `backend/Dockerfile` — no `USER` directive. `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]` runs as root.
- **What:** Defense-in-depth lapse. Mostly cosmetic in an isolated docker network with no inbound shell access, but easy to fix.

### M-5 — LiteLLM pinned to 1.41.11 (old)
- **Location:** `backend/requirements.txt`.
- **What:** LiteLLM `1.41.11` is significantly behind current releases. Worth checking GHSA for advisories and bumping during a maintenance window. (Note: `chromadb 0.4.24`, `fastapi 0.112.0`, `pydantic 2.8.2`, `pypdf 4.1.1` are also worth reviewing in the same pass.)

---

## Low

### L-1 — `log.exception(...)` writes full stack traces to stderr
- **Locations:** `backend/services/ingestion_service.py:109`, `backend/services/retrieval_service.py:60`.
- **What:** Full stack traces in stderr. Fine locally; only matters if logs are exported off-host. Listed for completeness.

### L-2 — Speculative `.gitignore` patterns absent
- **Location:** `.gitignore`.
- **What:** `*.key`, `*.pem`, `*.crt`, `service-account*.json`, `firebase-*.json` are not in `.gitignore`. No such files exist in the repo today (verified via `git ls-files` and repo-wide grep). Purely preventive.

---

## Checked and clean

The following were inspected and no issue was found.

- **Tracked secrets** — repo-wide grep for `sk-ant-`, `sk-proj-`, `sk-`, `AIza`, `-----BEGIN PRIVATE KEY-----`, `-----BEGIN RSA PRIVATE KEY-----`, `eyJ` returned only documentation/placeholders (e.g. `README.md` teaches the `AIza...` prefix shape but contains no real key). `git ls-files` for `.env*`, `*.key`, `*.pem`, `*.crt`, `service-account*.json`, `firebase-*.json` returned nothing tracked.
- **Frontend secret bundle** — no Firebase SDK in `frontend/package.json` (no `@firebase/*`); only `VITE_API_BASE_URL` is read on the client (`frontend/src/services/apiClient.js:5`, `frontend/src/services/uploadApi.js:3`); `frontend/vite.config.js` has no `define` or `envPrefix` override.
- **XSS** — no `v-html`, `innerHTML`, `dangerouslySetInnerHTML`, `eval`, or `new Function` anywhere in `frontend/src/`. Chat content rendered via `{{ m.content }}` (`frontend/src/views/SessionView.vue:120`), auto-escaped. No markdown / HTML renderer (no `marked` / `markdown-it` / `DOMPurify` in `package.json`) so no sanitization gap to plug.
- **Token storage** — `frontend/src/stores/user.js:20-61` stores only display state (`userId`, `name`, `interactionPreferences`, `onboardingComplete`) in `localStorage` under `crux:user:v1`. No API token stored anywhere. `resetOnboarding()` clears the key on logout.
- **ChromaDB exposure (prod)** — `docker-compose.prod.yml:45-49` uses `expose:` (network-only), no host port binding. ChromaDB unreachable from outside the docker network.
- **Per-session ChromaDB isolation** — `backend/services/chroma_client.py:11-16` creates `session_{session_id}` collections. Retrieval (`backend/services/retrieval_service.py:54-55`) and ingestion (`backend/services/ingestion_service.py:82-90`) both scope by session — no cross-session retrieval bleed by design.
- **Backend port exposure (prod)** — `docker-compose.prod.yml:17` uses `expose: ["8000"]`. Backend not reachable from host; only via nginx reverse proxy.
- **Reverse proxy hygiene** — `frontend/nginx.conf:15-24` proxies `/api/` to `http://backend:8000/api/` with standard `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers; 120s timeout for LLM responses; SPA fallback at line 38.
- **CI secrets** — `.github/workflows/ci.yml` and `.github/workflows/e2e.yml` reference no `secrets.*`. e2e job runs with `LLM_STUB=1` (`e2e.yml:20-24`), no real LLM/embedding calls. No `echo $...` / `cat $...` patterns that could leak env to logs.
- **README / docs** — `README.md` contains `AIza...` only as a placeholder format hint. No literal API key, password, or token strings.
- **`.gitignore` baseline** — `.env`, `.env.local`, `.env.*.local`, `frontend/.env`, `frontend/.env.local`, `data/*.db`, `data/uploads/`, `data/chroma/`, `spike/.env` all ignored; `!**/.env.example` whitelist correct for template files.
- **`.env.example` files** — root `.env.example` and `frontend/.env.example` contain only placeholders / localhost URLs; no real-looking values.
- **Input validation baseline** — Pydantic `extra="forbid"` is enforced on all request models (`backend/contracts/models.py`); `RetrieveChunksArgs.k` is bounded `conint(ge=1, le=20)`; `SessionCreateRequest.seed_mode` is `Literal["fresh", "resume"]`; enums on `knowledge_level`, `focus_clear_reason`, `evidence_type`. (Length bound is the only gap — H-3.)
- **Resume-mode ownership check** — `backend/routes/sessions.py:84` correctly validates `prior.user_id != req.user_id` and 404s on mismatch. Pattern exists; just not applied elsewhere (H-4).
- **Rate-limit primitive** — `backend/services/rate_limit.py:20-49` correctly increments per `(user_id, date_utc)` and returns 429 envelope with `cap`, `used`, `resets_at` (`backend/routes/chat.py:21`). The primitive is solid; just under-applied (H-1).
- **Backend SQL access** — All DB access via SQLAlchemy ORM (`db.get(...)`, `select(...).where(...)`); no raw SQL string composition; no SQL injection surface found.

---

## Notes on scope calibration

The following were considered and intentionally down-ranked or omitted because they don't apply at the 5-10-trusted-friends scale stated in the threat model:

- **No Firebase / no ID-token verification on protected routes** — Spec-locked as `Auth | None (localStorage userId) | v1 scope`. Not a vulnerability against the documented threat model. Re-evaluate if the deploy ever opens to untrusted users.
- **DDoS / rate-limit gaps on non-paid endpoints** — `/api/sessions`, `/api/profile`, `/health` are not rate-limited. Skipped: these don't trigger paid API calls; bandwidth abuse is irrelevant at this scale.
- **CORS strictness beyond origin allowlist** — Origin allowlist is the load-bearing control. Method/header tightening is included (M-1) as cheap defense-in-depth, but not Critical.
- **Container hardening beyond `USER` directive** — No read-only filesystem, no `cap_drop`, no seccomp profile. Skipped at this scale; included only the `USER` flip (M-4).
- **Docker base image digest pinning** — Tags are pinned (`python:3.12.13-slim`, `nginx:1.27.5-alpine`, `node:20.20.2-alpine`, `chromadb/chroma:1.5.9`). Digest-pinning would catch tag re-pushes; overkill here.
- **Audit logging / SIEM / structured-event pipeline** — Out of scope at this scale.
- **Secrets vault / KMS** — `.env` file is appropriate at this scale; rotation is manual.

---

## Summary table

| ID | Severity | Area | Single-line description |
|---|---|---|---|
| H-1 | High | Cost abuse | `/api/upload` not rate-limited; triggers paid embeddings unbounded |
| H-2 | High | Cost abuse | No upload file size cap |
| H-3 | High | Cost abuse / DoS-lite | No `max_length` on Pydantic string fields |
| H-4 | High | Cross-user data | Session/document endpoints don't verify `user_id` ownership |
| H-5 | High | Info leak | Raw exception strings returned to client (retrieval) |
| M-1 | Medium | CORS | `allow_methods/headers=["*"]` (origin still allowlisted) |
| M-2 | Medium | Path traversal | Unsanitized filename + ingestion fallback uses bare filename |
| M-3 | Medium | Prompt injection | Retrieved PDF chunks not delimited as untrusted data |
| M-4 | Medium | Container | Backend runs as root |
| M-5 | Medium | Dependency hygiene | LiteLLM 1.41.11 is old; audit other pinned versions |
| L-1 | Low | Logging | `log.exception` writes stacks to stderr (only matters off-host) |
| L-2 | Low | Defensive `.gitignore` | Missing `*.key`/`*.pem`/`service-account*.json` patterns |

See `docs/security/SECURITY_FIXPLAN.md` for the 4-phase remediation plan.

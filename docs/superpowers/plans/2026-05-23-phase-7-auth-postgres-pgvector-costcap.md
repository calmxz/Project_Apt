# Phase 7 Plan — Auth (Supabase) + Postgres + pgvector + LLM Cost Circuit Breaker

> **Status: DRAFT — 2026-05-23**
> Branch `phase/7-auth-postgres-pgvector-costcap` off `dev`.
> Predecessor: Phase 6 shipped as `cb93a28` (CI security automation + regression locks).
> Successor: Phase 8 (Fly.io deploy, R2 backups, ToS/privacy, invite-only waitlist gating, launch).

## Context

AdaptLearn v1 spec originally targeted trusted-friends scope with `Auth | None (localStorage userId)`. Release target was raised to **public deploy** during the 2026-05-23 security audit. Phase 6 hardened the CI surface and locked existing fixes; Phase 7 closes the structural gaps that block a public release:

1. **Identity** — `user_id` from localStorage is forge-able; any client can read/end any session by guessing IDs. Public deploy requires real auth.
2. **Data layer** — SQLite + file-based Chroma are single-machine assumptions. Public deploy needs a managed DB with a vector extension, both reachable from a Fly machine.
3. **Cost ceiling** — LiteLLM with no per-user spend cap means one runaway loop can drain the OpenAI/Anthropic balance. Need a soft + hard cap before the URL is public.

All three changes ripple across the schema, contracts, frontend session bootstrap, and tests. Bundling them is unavoidable — auth needs Postgres (Supabase requires Postgres), pgvector replaces Chroma in the same DB, and the cost-cap ledger lives in that DB too. Splitting into PRs across this branch is fine; splitting into separate branches risks merge hell.

## Branch

Off `dev`: **`phase/7-auth-postgres-pgvector-costcap`**

Verify `dev` is at `cb93a28` or later before branching.

## Scope (in)

| Area | Items |
|---|---|
| Auth | Supabase Auth (email magic-link or OAuth) on frontend; FastAPI dependency validates Supabase JWT and resolves `user_id` server-side; all routes drop `user_id` from request body in favor of token-derived identity |
| DB migration | SQLite → Postgres (Supabase-managed). Schema replayed via Alembic (or hand-applied if no Alembic yet). Hard cutover; no data migration script — existing localStorage userIds wiped per user direction |
| Vector store | ChromaDB → pgvector (same Postgres). Removes `chromadb` container from compose. `services/retrieval_service.py` and `services/ingestion_service.py` swap backend |
| LLM cost cap | `$2 soft warn / $3 hard cap` per user per day. LiteLLM `cost_callback` writes to a `daily_cost_ledger` table; chat/upload routes check before invoking the model and return `429 CODE_COST_CAP_REACHED` when exceeded |
| Contract updates | `openapi.yaml` drops `user_id` from chat/session/upload bodies; adds `Authorization: Bearer <jwt>` security scheme; adds `cost_cap_reached` error envelope. Regen via `gen_contracts.py` |
| Tests | Backend: replace `user_id` Form params in test fixtures with mocked JWT dependency; new `test_cost_cap.py`; new `test_pgvector_retrieval.py` (uses test Postgres in CI); update existing ownership tests to use auth header instead of query param. Frontend: Supabase client init + login view + auth guard on router; replace `localStorage userId` usage |
| Docs | Update `CLAUDE.md` architecture section (drop chromadb container, add Postgres + auth), update `SECURITY_REVIEW.md` (close H-4 retroactively now that auth is real), new `docs/auth/supabase-setup.md`, new `docs/db/postgres-pgvector-setup.md` |

## Scope (out)

- Fly.io deploy (Phase 8)
- R2 backup automation (Phase 8)
- ToS / privacy templates (Phase 8)
- Invite-only waitlist gate (Phase 8)
- Email/transactional via Supabase beyond magic-link login (Phase 8)
- Data migration of existing dev/local userIds (hard cutover per user direction; document in launch checklist)

## Tasks

### 1. Supabase project bootstrap (manual, user-executed)

User-side prereqs before code lands:
- Create Supabase project (free tier).
- Note: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (frontend), `SUPABASE_SERVICE_ROLE_KEY` (backend, server-only), `DATABASE_URL` (direct Postgres connection string with pooler).
- Enable Email auth (magic-link). Optionally GitHub OAuth.
- Apply pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;` (Supabase SQL editor).
- Add all four secrets to `.env.example` (placeholders) and `.env` (real values, gitignored).

### 2. Backend — Postgres schema replay

- Add `sqlalchemy[postgresql]` + `psycopg[binary]` to `backend/pyproject.toml`. Keep `sqlalchemy` version pinned.
- `backend/db/database.py`: switch engine URL to `DATABASE_URL` env. Drop sqlite fallback (test env can use `DATABASE_URL=postgresql://...test`).
- Apply existing `models.py` schema to Postgres. If no Alembic yet, add it and generate baseline `revision --autogenerate -m "phase-7 baseline"` against an empty Postgres. Run `alembic upgrade head`.
- Add `daily_cost_ledger` table to `models.py`: `(user_id PK, date PK, cost_usd_cents NUMERIC(10,2), updated_at)`.
- Verify all backend pytest passes against Postgres (CI matrix or local toggle).

### 3. Backend — Supabase Auth integration

- `backend/services/auth.py` (new):
  - `verify_supabase_jwt(token: str) -> str` returns `user_id` (Supabase `sub` claim). Use `supabase-py` lib or raw `pyjwt` against Supabase JWKS URL (cache JWKS).
  - FastAPI dependency `current_user_id(authorization: str = Header(...)) -> str` extracts bearer, calls verify, returns ID. Raises `401` on invalid/missing.
- All routes in `backend/routes/*` drop `user_id: str = Form/Body(...)` and add `user_id: str = Depends(current_user_id)`.
- `openapi.yaml`: add `securitySchemes.BearerAuth` + apply to all auth-required paths. Drop `user_id` request params. Regen contracts.
- Update every test that passes `user_id` to instead inject a mocked dependency (override `current_user_id` in test client fixture).

### 4. Backend — pgvector replaces Chroma

- `backend/services/retrieval_service.py`: replace Chroma client with raw SQLAlchemy + pgvector query. Schema:
  ```sql
  CREATE TABLE chunk_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_index INT NOT NULL,
    embedding vector(1536),  -- match LiteLLM embed dimension
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX ON chunk_embeddings USING ivfflat (embedding vector_cosine_ops);
  ```
- `backend/services/ingestion_service.py`: write embeddings to `chunk_embeddings` instead of Chroma collection.
- Drop `chromadb` from `backend/pyproject.toml` deps + remove the `chromadb` service from `docker-compose.yml` and `docker-compose.prod.yml`.
- Add `pgvector==<latest>` to backend deps for the SQLAlchemy adapter.
- Existing retrieval tests (mocked Chroma) rewritten against an in-memory pgvector or live test Postgres.

### 5. Backend — LLM cost cap — SHIPPED 2026-05-23

- `backend/services/cost_meter.py` (new):
  - `record_cost(db, user_id, cost_usd)` upserts into `daily_cost_ledger` for today's UTC date. Ignores zero/negative inputs.
  - `check_cap(db, user_id) -> CapStatus` returns a frozen dataclass `(allowed, used, soft_breached, soft_cap, hard_cap)` — semantically equivalent to the planned `(allowed, current_usd, level)` tuple but with both thresholds exposed for the envelope.
  - Thresholds: `llm_soft_cap_usd=2.00`, `llm_hard_cap_usd=3.00` from `config.Settings` (env-overridable).
- Cost recording moved from a global LiteLLM `success_callback` into the `agent/tutor.py` loop — per-`acompletion` call we read `litellm.completion_cost(completion_response=resp)` and call `cost_meter.record_cost`. Reason: the agent loop fires up to MAX_ITERS=8 calls per chat turn for tool dispatch; a single post-turn record would undercount. Also keeps DB writes inside the same request's session.
- `routes/chat.py` pre-call gate: `cost_meter.check_cap` → 429 with envelope `{code: "daily_cost_cap_reached", soft_cap_usd, hard_cap_usd, used_usd, resets_at}`. Post-call: re-check, set `X-Cost-Warning: soft_cap_breached;used_usd=...;soft_cap_usd=...;hard_cap_usd=...` header when above soft and below hard.
- Mid-turn defense: `tutor.run` re-checks `check_cap` at the top of each iteration (i>0); if a single LLM call alone pushes spend past the hard cap, the loop short-circuits to `FALLBACK_TEXT` instead of issuing another acompletion.
- `lib/error_codes.py`: added `DAILY_COST_CAP_REACHED = "daily_cost_cap_reached"`.
- Upload route is **not** gated on cost (the original plan called for it). Rationale: upload's only LLM-touching path is the background ingestion task, which mints embeddings asynchronously and currently doesn't surface 429s back to the client; gating the upload synchronously would block a free action. Revisit in T7 if embeddings cost becomes material.
- New `backend/tests/test_cost_cap.py` — 12 tests, all green:
  - Unit: zero-spend default, row-create, accumulation, zero/negative ignore, allowed/soft-breached/hard-blocked check_cap.
  - Integration: 429 envelope when pre-seeded ledger ≥ hard cap; `X-Cost-Warning` header when seeded between soft and hard; header absent when below soft.
  - Tutor-loop: per-acompletion cost recording into ledger; short-circuit when first call pushes spend past hard cap.
- Coverage: `services/cost_meter.py` 100%, full suite 150 passed / 88.24% overall.

### 6. Frontend — Supabase Auth

- Add `@supabase/supabase-js` to `frontend/package.json`.
- `frontend/src/services/supabase.js` (new): exports a singleton client built from `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- `frontend/src/views/LoginView.vue` (new): magic-link form. Submits email, shows "check your email" state.
- `frontend/src/router/index.js`: add `/login` route. Add `beforeEach` guard — if no Supabase session, redirect to `/login`. Allow `/login` itself.
- `frontend/src/stores/user.js`: replace `localStorage userId` reads with `supabase.auth.getSession()` → `session.user.id`. On `auth.onAuthStateChange('SIGNED_OUT')`, clear store + redirect.
- Every `fetch`/axios call in `frontend/src/services/*Api.js`: replace any body `user_id` field with `Authorization: Bearer ${session.access_token}` header. Use a shared `authFetch` helper.
- Drop `user_id` from frontend stores/views (`session.js`, `HomeView.vue`, `NewSessionView.vue`, `SessionView.vue`, `ProfileView.vue`, `AggregateProfileView.vue`, `SettingsView.vue`).
- Add a "Sign out" button in `App.vue` topnav menu.

### 7. Frontend — Cost cap UX

- 429 with `code: "cost_cap_reached"` shown as a disabled-input banner: "Daily cost cap reached. Resets <time>." Match existing daily-cap banner pattern in `stores/session.js`.
- `X-Cost-Warning` header → soft toast "Approaching daily cap" once per session.

### 8. Contract regen

- After all `openapi.yaml` edits: run `python backend/scripts/gen_contracts.py`. Commit the regenerated `backend/contracts/*.py`. CI drift check enforces zero diff.

### 9. Tests

**Backend (new + rewritten):**
- `tests/conftest.py`: replace `client` fixture's `user_id` injection with a dependency override that yields a fixed `test_user_id` string.
- Every `test_*_for_wrong_user` test rewritten: instead of passing `user_id=B`, override the dependency for one request only to return `B`'s ID, assert 404.
- `tests/test_cost_cap.py` (new): see Task 5.
- `tests/test_pgvector_retrieval.py` (new): chunks written, top-k cosine query returns expected order. Uses pytest-postgresql or testcontainers; fall back to a local Postgres on `127.0.0.1:55432` for dev.
- `tests/test_auth_dependency.py` (new): valid JWT → 200; missing → 401; expired → 401; wrong signature → 401.

**Frontend (new):**
- `src/__tests__/loginView.test.js`: form submission triggers `supabase.auth.signInWithOtp`.
- `src/__tests__/authGuard.test.js`: no session → router pushes to `/login`.
- `e2e/auth.spec.js` (Playwright): magic-link mocked via `page.route`. Login → app loads.

### 10. Docs

- `CLAUDE.md` architecture diagram: drop `chromadb` service, add `postgres` (Supabase-managed, not in compose), update volume list.
- `docs/auth/supabase-setup.md` (new): step-by-step Supabase project creation, env var population, JWKS URL, RLS not used (server validates).
- `docs/db/postgres-pgvector-setup.md` (new): pgvector enable, `chunk_embeddings` schema, ivfflat tuning notes.
- `docs/security/SECURITY_REVIEW.md`: H-4 (ownership 404) moved to "Resolved by Phase 7 auth — token-derived `user_id` makes spoofing impossible." Add Phase 7 closeout footer.
- `docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`: spec edit to flip `Auth | None (localStorage userId)` → `Auth | Supabase (JWT)`. Note Phase 7 as the change point.

### 11. Verification

- [ ] Local Postgres + pgvector reachable from backend container
- [ ] Backend `pytest -v` green against Postgres (CI matrix or local toggle)
- [ ] Coverage ≥ 75% (Phase 6 gate held)
- [ ] Frontend `npm run test:unit -- --run` green
- [ ] Frontend `npm run lint` clean
- [ ] Playwright `auth.spec.js` green
- [ ] Contract drift check green (regen produces zero diff)
- [ ] Manual: sign up via magic link, create session, chat, upload PDF, hit cost cap (set `LLM_HARD_CAP_USD=0.01` to force), see banner
- [ ] Manual: sign in as user B, try to GET user A's session → 404
- [ ] Manual: docker compose up succeeds without `chromadb` service
- [ ] CI green on PR `phase/7-auth-postgres-pgvector-costcap` → `dev`

### 12. Manual post-merge (USER, web UI)

- Rotate any test Supabase keys before public deploy.
- Confirm Supabase project's allowed redirect URLs include both `http://localhost:5173` (dev) and the eventual production origin (set in Phase 8).
- Wipe any dev SQLite DB before promoting `dev` → `main` (hard cutover; no migration).

## Critical files

**Created (~14):**
- `backend/services/auth.py`
- `backend/services/cost_meter.py`
- `backend/db/alembic/` (if introducing Alembic)
- `backend/tests/test_cost_cap.py`
- `backend/tests/test_pgvector_retrieval.py`
- `backend/tests/test_auth_dependency.py`
- `frontend/src/services/supabase.js`
- `frontend/src/views/LoginView.vue`
- `frontend/src/__tests__/loginView.test.js`
- `frontend/src/__tests__/authGuard.test.js`
- `frontend/e2e/auth.spec.js`
- `docs/auth/supabase-setup.md`
- `docs/db/postgres-pgvector-setup.md`
- `docs/superpowers/plans/2026-05-23-phase-7-auth-postgres-pgvector-costcap.md` (this file)

**Modified (~25):**
- `backend/db/database.py`
- `backend/db/models.py`
- `backend/services/retrieval_service.py`
- `backend/services/ingestion_service.py`
- `backend/routes/chat.py`, `sessions.py`, `upload.py`, `profile.py`
- `backend/pyproject.toml`
- `backend/main.py` (auth dependency wiring)
- All `backend/tests/test_*.py` that fixture `user_id`
- `docs/api/openapi.yaml`
- `backend/contracts/*.py` (regenerated)
- `frontend/package.json`
- `frontend/src/router/index.js`
- `frontend/src/stores/user.js`, `session.js`
- `frontend/src/services/*Api.js` (every file — switch to bearer auth)
- `frontend/src/views/*.vue` (drop user_id usage)
- `frontend/src/App.vue` (sign-out button)
- `docker-compose.yml`, `docker-compose.prod.yml` (drop chromadb service)
- `.env.example`
- `CLAUDE.md`
- `docs/security/SECURITY_REVIEW.md`
- `docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`

## Decisions (locked 2026-05-23)

1. **Auth provider:** Magic-link only. No OAuth in Phase 7.
2. **pgvector index:** `ivfflat` with default `lists=100`. Revisit if RAG latency degrades or dataset crosses 100k chunks.
3. **Migrations:** Alembic. Baseline revision generated against empty Postgres on first apply. Every schema change = `alembic revision --autogenerate` + `alembic upgrade head`.
4. **Cost cap reset window:** UTC midnight. Aligns with existing daily-message cap; one boundary across all counters. Ledger keyed by `(user_id, date)`.
5. **Cost cap currency:** USD. LiteLLM's `cost_callback` returns USD natively across providers (OpenAI, Anthropic). No conversion needed.
6. **Supabase project:** USER creates project upfront and supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` before code lands. Real values enable integration tests against live JWKS.

## Open items deferred to Phase 8

| Item | Reason |
|---|---|
| Fly.io deploy | Needs Phase 7 stack landed. |
| R2 backup automation | Cron job in Fly machine; needs Fly account + R2 bucket. |
| ToS / privacy from generator | Pre-launch checklist. |
| Invite-only waitlist gate | Application-level guard, depends on auth (Phase 7) + deploy (Phase 8). |
| Custom domain + TLS | Fly.io handles; Phase 8. |
| Sentry / error tracking | Optional; defer unless time. |
| Observability (logs to external sink) | Optional; Fly tail OK for v1 launch. |

# Slice 1: Security + Foundation (S1, S2, R0) — Design

Date: 2026-07-06
Status: Approved (brainstormed with user; scope decisions recorded below)
Parent: `docs/planning/2026-07-06-10x-roadmap.md` (tracks S1, S2, R0)
Branch: `feat/roadmap-slice1` off `dev`. One PR.

## Scope decisions (user-confirmed)

1. Slice = S1 + S2 + R0 full (cleanup AND event enrichment + cost attribution).
2. Non-streaming chat chain: DELETE end-to-end, including `tutor.run`.
3. Quiz follow-up turns COUNT against the main 50/day message cap.
4. Cost attribution: NEW `llm_call_log` table; daily ledger untouched.
5. One-off scripts: backfill re-run against live Supabase 2026-07-06
   (8 rows caught, second run = 0; probe confirmed pgvector 0.8.0 / pg 17.6).
   Purpose complete — both scripts deleted.
6. `docker-compose.yml`: NOT deleted — restored to a working dev stack
   (`docker compose up` runs frontend + backend against Supabase).
7. `followup_skipped` field name chosen by Claude: `followup_skipped: "daily_cap"`.

## 1. S1 — document_excerpt delimiter escape (prompt-injection fix)

Problem: retrieved chunk text is interpolated raw into
`<document_excerpt id=...>` wrappers in BOTH agent loops
(`backend/agent/tutor.py:150-160` non-stream, `:477-487` stream). A malicious
uploaded document containing the literal string `</document_excerpt>` closes
the tag early and plants instructions outside the guarded region, defeating
the defense declared in `prompts.py:109-113`.

Design:
- New shared helper (single choke point), e.g.
  `backend/agent/excerpt.py::wrap_excerpts(chunks) -> str`, used by both loop
  implementations so they cannot drift. (After R0.1 deletes `tutor.run`, only
  the streaming loop remains, but the helper still earns its keep as the one
  tested unit.)
- Sanitization: case- and whitespace-tolerant neutralization of any
  `</document_excerpt` or `<document_excerpt` sequence inside chunk text —
  regex `(?i)<\s*/?\s*document_excerpt` with `<` replaced by `&lt;`. Wrapper
  attributes (id, doc_name, page) come from our own DB values, but doc_name
  originates from user upload filename — sanitize attribute values too
  (strip `<`, `>`, `"`).
- Ingestion-time sanitization considered and REJECTED: defense belongs at the
  prompt boundary (one choke point); re-chunking/re-embedding existing data
  for a second layer is not worth the cost. Recorded here per roadmap S1 AC3.

Tests:
- Unit: chunk containing `</document_excerpt>`, `</ DOCUMENT_EXCERPT`, and
  `<document_excerpt id=fake>` variants — all neutralized, wrapper integrity
  preserved.
- Unit: doc_name containing `">` cannot break the tag.
- Existing prompt-injection-defense tests stay green.

## 2. S2 — quiz follow-up turns count against the daily message cap

Problem: `POST /sessions/{id}/check/complete` fires a full tutor streaming
turn but deliberately skips `rate_limit.check_and_increment`
(`backend/routes/sessions.py:423-435`). Unbounded free LLM turns vs the
50/day cap; only the $3 cost hard-cap backstops.

Design:
- Ordering invariant: GRADING IS NEVER BLOCKED. Batch resolution, profile
  effects, and learning-event writes commit before any cap check.
- After resolution commits, `check/complete` calls
  `rate_limit.check_and_increment(user_id)`:
  - Under cap: increment, follow-up streaming turn proceeds as today.
  - Over cap: NO follow-up LLM turn. The endpoint still responds as SSE
    (content type unchanged for the client): it emits a single new stream
    event `followup_skipped` with `{"reason": "daily_cap"}` (added to
    `backend/agent/stream_events.py` vocabulary) followed by the normal
    terminal event. No HTTP error (the grading succeeded).
- `check/answer` and `check/skip` stay uncounted — they make no LLM call.
- Frontend: `chatStreamService` handles `followup_skipped` by rendering a
  quiet inline notice in the chat ("Daily message limit reached — recap
  saved, tutor follow-up skipped"), reusing existing muted-notice styling.
  No error toast. Recap card renders normally.
- Contract: SSE event vocabulary is code-defined (`stream_events.py`), not in
  `openapi.yaml` (consistent with existing events like `cost_warning`), so
  no OpenAPI change for S2.

Tests:
- BE: cap-at-limit → batch resolves, events written, no LLM invocation
  (assert via stub), `followup_skipped == "daily_cap"`, counter NOT
  incremented past cap.
- BE: under cap → counter incremented exactly once per resolved batch;
  follow-up runs.
- BE: answer/skip endpoints do not touch the counter (regression guard).
- FE: notice renders on flag; no toast; recap intact.

## 3. R0.1 — cleanup

### 3a. Delete the non-streaming chat chain (end-to-end)

Frontend: `src/services/chatApi.js`, store action `sendMessage`
(`stores/session.js:174-237`), `SessionView` non-stream else-branch and the
`VITE_CHAT_STREAM` flag (`SessionView.vue:154,377`), `frontend/.env.example`
entry, and the vitest override (`vitest.config.js:14`).

Backend: `POST /api/chat` non-streaming route + response assembly in
`routes/chat.py`, `tutor.run` (only consumer), and the now-orphaned
non-stream halves of shared helpers. `_prepare_turn` and everything the
streaming path uses stays.

Contract: remove `POST /chat` (non-stream) from `openapi.yaml`; codegen drops
`ChatResponse`. CI drift gate proves zero manual contract edits.

Ordering (risk control): unit tests currently exercise chat through the
forced non-stream mode. Task order is MIGRATE TESTS FIRST — a stream-mock
harness (mock SSE reader / `chatStreamService` stub) replaces non-stream-mode
tests while both paths still exist and the suite is green; only then delete.
The suite never goes dark.

### 3b. Small deletions

- `frontend/src/utils/checkBatch.js` + `__tests__/checkBatch.test.js`
  (only importer is its own test).
- `backend/services/learning_event_service.py::record()` (unreachable since
  `record_learning_event` left the tool set; `record_from_answer` stays).
  The `is_gradable` guard dies with it; git history preserves.
- `backend/scripts/backfill_check_batch.py`, `backend/scripts/probe_pgvector.py`
  (verified complete 2026-07-06, see scope decision 5).
- `analysis/mlp_checkpoint.md` (references the removed multi-lesson-plan
  feature).

### 3c. Docs

- HISTORICAL banner atop `docs/Crux_Spec.md` and `docs/Crux_DevPlan.md`:
  one prominent paragraph stating they describe the superseded
  Firebase/ADK/Firestore architecture and that
  `docs/superpowers/specs/2026-05-03-crux-v1-design.md` is current. No
  rewrite (they remain v2 reference per CLAUDE.md).
- `docs/security/SECURITY_REVIEW_2026-06-22.md`: add S1 + S2 entries as
  fixed-in-this-PR with file refs; correct the JWT-iss row to Fixed
  (`services/auth.py:53-54` already implements it).

### 3d. docker-compose.yml restored to a working dev stack (user decision)

`docker compose up` must run the app again. Both `frontend/Dockerfile` and
`backend/Dockerfile` exist; `docker-compose.prod.yml` holds the deploy stack.
Dev compose gets:
- `backend`: build `backend/`, port 8000, env passthrough from `.env`
  (DATABASE_URL, Supabase, LLM keys — file NOT read by tooling, compose
  `env_file` reference only), migrate-on-start entrypoint (same pattern the
  prod compose/deploy entrypoint uses), volume `./data/uploads`.
- `frontend`: build `frontend/`, port 5173, `VITE_*` env passthrough,
  API base pointed at `http://localhost:8000`.
- No DB service (Supabase-managed, external).
- CLAUDE.md commands table stays accurate ("Start full stack:
  `docker compose up`" becomes true again); add the native
  `uvicorn --reload` / `npm run dev` row as the faster alternative.

Verification: `docker compose config` in CI-adjacent check or manual gate;
manual smoke = compose up, login, one chat turn (human gate, listed in PR).

## 4. R0.2 — data foundation

### 4a. Learning-event enrichment (migration 0013)

Note: 0012 is taken (`0012_terms_acceptance.py`); this slice adds 0013 + 0014.

`learning_events` gains nullable columns:
- `selected_index` (int), `correct_index` (int), `options_json` (text),
  `purpose` (text: `diagnostic` | `check`).

Populated by `record_from_answer` from the live batch item at grading time.
Old rows stay null — no backfill. Alembic upgrade + downgrade, sqlite
CI-parity green.

Contract: the profile recent-events shape in `openapi.yaml` exposes the new
nullable fields (single contract churn now; R3 consumes later). Codegen +
drift gate.

### 4b. Per-call LLM cost attribution (migration 0014)

New table `llm_call_log`:
- `id` (pk), `user_id` (fk, indexed), `session_id` (nullable fk, indexed),
  `purpose` (text: `chat` | `followup` | `summary`), `model` (text),
  `cost_usd` (numeric(10,4)), `created_at` (timestamptz).

Written at the existing metering points: per-iteration in the streaming loop
(`tutor.py` meter calls) and in `summary_service`. Purpose `followup` set on
the check/complete path. NO readers in this slice (R3.2 consumes later).
`daily_cost_ledger` and all cap-gating logic untouched — existing cost-cap
tests are the regression guard.

Failure isolation: a failed log insert must never fail the user turn — same
transaction-safety posture as existing metering; test asserts turn succeeds
when log write raises.

## 5. Out of scope

P tracks (caching, token reduction, TTFT), D tracks (context enrichment,
temperature), S3 (CSP/vercel.json + JWKS fail-fast — pairs with the RUNBOOK
deploy human gate), R1+ product features. `spike/` untouched.

## 6. Testing + verification summary

- TDD per task (superpowers flow); full backend pytest + frontend vitest +
  lint + codegen drift gate green before PR.
- New security tests: S1 forged-delimiter suite, S2 cap-path suite.
- Deletion safety: repo-wide grep for deleted symbols/testids
  (lesson from sessions-ux-perf: vitest green does not cover Playwright
  references) — includes `e2e/` specs.
- Migrations: upgrade/downgrade round-trip on sqlite AND against a scratch
  Postgres if available; live Supabase migration is a listed human gate at
  merge time (alembic upgrade head), same as migration 0011.
- Manual human gates recorded in PR: compose-up smoke, live cap-skip smoke
  (cheap — set daily cap low in env), live migration.

## 7. Risks

1. Non-stream test migration breadth — mitigated by migrate-tests-first
   ordering (3a) and full-suite gate per task.
2. `llm_call_log` write on the hot loop path — mitigated by failure-isolation
   test and no added round trip beyond the existing meter transaction.
3. Compose env drift (compose vs render entrypoint) — mitigated by reusing
   the same migrate-on-start entrypoint file, not a copy.

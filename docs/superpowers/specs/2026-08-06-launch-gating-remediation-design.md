# Launch-Gating Remediation — Design Spec

- **Date:** 2026-08-06
- **Status:** Approved (brainstormed + approved in session 2026-08-06)
- **Source:** `docs/reviews/2026-08-06-qa-audit/` (107 findings; verdict NOT READY)
- **Goal:** Flip the deployment-checklist verdict from NOT READY to READY for a **closed beta of tens of users**.

## Context

The 2026-08-06 QA audit found 5 Criticals — all in the upload/ingestion pipeline — plus
one missing operational discipline (production logging) and an unproven backup restore.
The checklist names four findings blocking at any scale (B-01, F-03, G-05, W-02) and
states that a focused remediation, not a rewrite, changes the verdict.

Two scoping decisions were made and are fixed for this spec:

1. **Audience: closed beta (tens of users).** Capacity ceilings (F-01, F-06/07/08) drop
   to Medium and are out of scope.
2. **Ingestion fix: worker service now** (audit's durable fix), not in-process
   mitigation. Accepts one extra Render service and its cost in exchange for
   structurally removing background work from the request process.

## Goals

- Close every item the checklist marks **Blocking: Yes** for a closed beta.
- Convert the five Criticals' subsystem (upload/ingestion) to an out-of-process,
  idempotent, cost-capped, memory-bounded worker.
- Establish production diagnosability (structured logging + correlation ids).
- Make CI gates real (lint gate can fail, CI runs on dev pushes, hermetic tests).
- Guide the human-only gates (restore drill, dashboard toggles) to closure.

## Non-goals

- Public-launch capacity work: F-01 pool/worker sizing, F-06/F-07/F-08 unbounded list
  endpoints.
- G-01 summary-laundering taint boundary (next batch; see improvements SI-01).
- E-05/E-11/E-14 composer-clearing UX bugs (high-complaint, not launch-blocking).
- All remaining Mediums/Lows in the bug tracker.
- Account deletion (SI-06), global job system beyond ingestion, async DB engine.

## Scope

### Code workstreams

| # | Finding(s) | Work |
|---|---|---|
| 1 | Q-01 | Hermetic backend test suite: tests must not load the developer's real `.env`; green on any dev machine. |
| 2 | Q-02 | CI lint gate runs check-only (no auto-fix) so it can fail on violations. |
| 3 | Q-05 | CI triggers on direct pushes to `dev`, not only PRs. |
| 4 | B-01 | Upload/ingestion consult the LLM cost cap before spending. |
| 5 | B-04 (mitigation) | Global daily dollar ceiling: one env var, one ledger-sum check; reuses the existing per-user cap's error code family when exceeded. |
| 6 | F-03 | Chunk-count cap: byte-based pre-estimate rejects at upload with coded 413; hard `MAX_CHUNKS` enforcement after real chunking. |
| 7 | G-05 | `logging.dictConfig` for app + worker: timestamp, level, logger, message; uvicorn loggers wired. |
| 8 | G-06 | Request-id middleware; agent-loop and ingestion logs carry `session_id` / `user_id` / `document_id`. |
| 9 | F-02, F-04, B-02 | Ingestion moved to a worker service (design below). |
| 10 | D-01..D-04 | Accessibility blockers: login flow operable unaided by screen reader; check-question answer produces an announced result. |
| 11 | C-02 | nginx `client_max_body_size` raised to match the 25 MB app limit on both compose stacks. |

### Human gates (guided, not automatable)

| Gate | Action |
|---|---|
| W-02 | Run the R2 restore drill per `docs/deploy/RESTORE.md`. Expect first-run failures; fix and re-run until clean. |
| W-07 | Enable branch protection + code scanning (GitHub dashboard). |
| W-14 | Confirm Supabase anonymous sign-in is DISABLED (Supabase dashboard). |
| W-15 | Confirm `SUPABASE_JWKS_URL_OVERRIDE` is absent (not merely empty) from prod env definitions. |

## Design

### Worker service (F-02 / F-04 / B-02)

**Queue: DB-backed, no new infra.** The `documents` row is the job record. No Redis, no
external queue service.

- **Upload route** saves the file to the object store, inserts the document row with
  `status='pending'`, and returns immediately. No ingestion work happens in the request
  process — no `BackgroundTasks` ingestion path remains.
- **Worker process** runs from the same backend image with a different start command
  (`python -m worker`). It owns a small DB pool separate from the web pool.
- **Job claim:** `SELECT ... FOR UPDATE SKIP LOCKED` on pending documents, then an
  atomic transition to `status='processing'`. Multiple workers are safe by construction
  even though one is deployed.
- **Connection discipline:** the worker releases its DB connection between embedding
  batches. No connection is held across a network call to the embedding API.
- **Memory bound:** chunks are embedded and inserted **per batch** (existing
  `EMBED_BATCH=100`); the full vector list is never materialized. This removes the
  ~630 MB peak rather than merely capping input size. The flat token/page-index lists
  from chunking are dropped as soon as chunk texts are produced.
- **Idempotent resume:** on worker boot, rows stuck in `processing` are reset to
  `pending`. Chunk inserts are idempotent (upsert keyed on document + chunk index), so
  a re-run after a crash never duplicates rows and never re-pays for batches already
  persisted. Already-persisted batches are detected and skipped before calling the
  embedding API.
- **Failure states:** unrecoverable errors set `status='failed'` with a coded reason
  the frontend can render (cap exceeded, chunk cap exceeded, extraction error).
- **Deploy:** `render.yaml` gains a `type: worker` service; `docker-compose.yml` and
  `docker-compose.prod.yml` gain a `worker` service sharing the backend build.
- **Frontend:** unchanged. It already polls document status; `pending` simply lasts
  slightly longer before `processing` begins.

### Cost control (B-01 / B-04)

- **Per-user cap (B-01):** the worker calls the existing cap check before **each**
  embedding batch, attributing spend to the uploading user. Over-cap mid-document sets
  `status='failed'` with the cap-exceeded code; already-persisted batches remain (the
  document can be re-run after the cap window resets, skipping paid batches).
- **Global ceiling (B-04 mitigation):** a `GLOBAL_DAILY_COST_CAP_USD` env var checked
  against a `daily_cost_ledger` sum at the same call sites as the per-user cap (chat +
  ingestion). Exceeded → coded error, no LLM/embedding call is made. Unset → disabled
  (current behavior). This is a brake, not a full multi-tenancy cost design.

### Chunk cap (F-03)

- **Upload-time pre-estimate — plaintext extensions only:** for `.txt`-class uploads,
  bytes are characters, so `file_bytes / 6.38 (chars per token, measured) / 450
  (stride)` is a sound chunk estimate. Above `MAX_CHUNKS` → coded 413 at upload,
  before any work. The estimate is **not** applied to PDFs — a 25 MB PDF extracts far
  less text than its byte size (audit: ~1,100–2,200 chunks), so a byte-based estimate
  would wrongly reject every large PDF. PDFs rely on the worker-time cap, which fires
  before any embedding spend. The 25 MB byte gate remains as a transport bound for all
  extensions.
- **Worker-time hard cap:** after real chunking, if actual chunks exceed `MAX_CHUNKS`,
  ingestion stops with `status='failed'` and the chunk-cap code before any embedding
  call. The pre-estimate is advisory; this is the enforcement.
- **`MAX_CHUNKS` default: 5,000** (env-overridable). Rationale: comfortably above the
  audit's measured worst realistic PDF (~2,200 chunks) and below the degenerate
  25 MB `.txt` case (~9,100). With per-batch streaming, memory no longer scales with
  chunk count, so the cap bounds per-document embedding cost (~$0.37 at 5,000 chunks)
  and ingestion time (~50 batches, ~1.3 min typical), not memory.
- **API contract:** the 413 and failure-reason codes are added to
  `docs/api/openapi.yaml` first, then contracts regenerated (repo codegen rule).

### Logging (G-05 / G-06)

- `logging.dictConfig` applied at both app boot and worker boot: ISO timestamp, level,
  logger name, message; `uvicorn`, `uvicorn.access`, and `uvicorn.error` wired to the
  same formatter. Level from env (`LOG_LEVEL`, default `INFO`).
- Request-id middleware: uuid4 per request, echoed as a response header and bound into
  log records for the request's duration.
- Agent-loop and ingestion log lines carry `session_id`, `user_id`, `document_id`
  where applicable.
- **PII rule:** identifiers are loggable; message content, document content, and chunk
  text are never logged.

### Accessibility blockers (D-01..D-04)

Per the audit: a blind user cannot get past login unaided and gets silence after
answering a check question. Fixes follow the audit's per-finding recommendations
(labels/announcements on the login flow; an `aria-live` result announcement for
check-question outcomes). Small diffs; exact attributes anchored during planning from
the D-finding bodies.

### nginx body size (C-02)

`client_max_body_size 25m;` (matching the app-level limit) in the nginx config used by
both `docker-compose.yml` and `docker-compose.prod.yml`, so a realistic PDF upload no
longer 413s at the proxy with an HTML page the frontend cannot parse.

### CI gates (Q-01 / Q-02 / Q-05)

- **Q-01:** backend tests get an explicit hermetic environment (settings fixture /
  env isolation) so `pytest` from `backend/` passes with or without a real `.env`
  present, and live credentials never load into a test run.
- **Q-02:** the CI lint step runs the linters in check mode (no `--fix`), so a fixable
  violation fails the gate.
- **Q-05:** CI workflows also trigger on `push` to `dev`.

## Testing

TDD per task (repo rule). New coverage:

- Worker: claim/transition, stuck-row reset on boot, idempotent re-run (no duplicate
  chunks, skipped paid batches), failure-state codes.
- Cost: per-batch cap check honored mid-document; global ceiling blocks at both call
  sites; unset ceiling = disabled.
- Chunk cap: pre-estimate 413 contract test; worker-side hard stop before embedding.
- Logging: dictConfig smoke (format fields present); request-id header echo.
- A11y: static assertions in vitest where possible (labels, roles, aria-live
  presence); full screen-reader behavior stays a manual gate.
- Contract: openapi.yaml edited first, codegen run, CI drift check stays green.
- Existing suites (831 frontend tests, backend suite) remain green; hermetic fix (Q-01)
  lands first so all later work verifies against a trustworthy suite.

## Sequencing

Five PRs to `dev`, each independently mergeable, ordered to mirror the checklist's
"Suggested order of work":

1. **PR-1 — Foundations:** Q-01 hermetic tests, Q-02 lint gate, Q-05 CI on dev pushes.
2. **PR-2 — Money:** B-01 cap consult, F-03 pre-estimate + cap plumbing, B-04 global
   ceiling.
3. **PR-3 — Logging:** G-05 dictConfig, G-06 request ids + correlation fields.
4. **PR-4 — Worker:** ingestion extraction, idempotent resume, per-batch
   embed-and-insert, compose + render.yaml services. Largest PR; any Alembic migration
   goes through the `migration-reviewer` agent before commit (repo rule).
5. **PR-5 — UX/deploy blockers:** D-01..D-04 accessibility fixes, C-02 nginx body size.

Human gates run after PR-4 is merged: W-02 restore drill, W-07 branch protection,
W-14 anonymous sign-in check, W-15 JWKS override absence.

## Risks

- **Worker + web race on document rows:** mitigated by `FOR UPDATE SKIP LOCKED` claims
  and single-purpose status transitions; tested explicitly.
- **Cap check per batch adds a ledger read per ~100 chunks:** negligible at beta scale;
  revisit with the materialized aggregate (improvements, long-term item 4) if needed.
- **Restore drill may surface latent schema hazards** (C-15, C-16, C-18 become
  reachable during restore): expected and desirable — checklist says "expect it to
  fail the first time; that is the point." Fixes, if needed, are follow-ups, not scope
  creep into this spec.
- **Render worker cost:** accepted in the scoping decision.

## Success criteria

- All checklist **Failed** rows marked Blocking:Yes for closed-beta scale are closed:
  F-1 (B-01), F-2 (B-02/F-02/F-03), F-3 (G-05/G-06), F-4 (W-02), F-7 (D-01..D-04),
  F-8 (C-02). F-6 (Q-01) also closed.
- `pytest` green from `backend/` on the dev machine with a real `.env` present.
- One 25 MB `.txt` upload on a 512 MB-class instance completes or fails cleanly with a
  coded reason — never OOM — and never blocks chat for another user.
- Kill the worker mid-ingestion; restart resumes without duplicate chunks or re-paid
  embedding batches.
- Log output in the deployed environment shows timestamped, leveled, request-id-tagged
  lines for a chat turn and an ingestion run.
- Restore drill performed once end-to-end and documented in `RESTORE.md`.
- Deployment checklist verdict updated from NOT READY to READY-for-closed-beta.

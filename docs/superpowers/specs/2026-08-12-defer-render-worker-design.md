# Defer Render Worker: In-Process Ingestion — Design

**Date:** 2026-08-12
**Status:** Approved
**Supersedes:** the dedicated `crux-worker` deployment topology introduced during the
2026-08 QA audit remediation (finding B-02 / F-02 / F-04). Code architecture is
unchanged; only the deployment topology reverts.

## Problem

The only Render paid line item at deploy time is `crux-worker` (`plan: starter`,
~$7/mo), a dedicated service running `python -m worker` to ingest uploaded PDFs
out-of-process. For a closed beta with a handful of users, the isolation it buys
(audit finding B-02: ingestion CPU contention inside the web threadpool) is not
yet needed. Without a worker, uploads would sit `pending` forever — the upload
route only enqueues; there is no inline ingestion path.

## Decision

Run the existing worker poll loop (`backend/worker.py::main_loop`) as a
background daemon thread inside the web service, started from the FastAPI
lifespan, gated by a new settings flag that defaults ON. Remove the dedicated
worker service from `render.yaml` and both docker-compose files. Keep
`worker.py`, its tests, and the `python -m worker` entrypoint intact so the
dedicated-worker topology can be restored by config alone.

### Decisions locked during brainstorming

1. **Flag defaults ON** (`INGEST_IN_PROCESS=true`). Web always drains the queue
   unless explicitly disabled. If a dedicated worker later runs alongside a web
   instance that forgot to disable the flag, `FOR UPDATE SKIP LOCKED` claiming
   makes dual runners safe — only redundant polling, no correctness risk.
2. **No worker auto-detection / heartbeat.** Considered and rejected: it adds a
   liveness protocol, DB state, and flapping edge cases to solve a failure mode
   (dual runners) the queue already tolerates. At scale the correct pattern is
   dumb workers + queue-depth monitoring, not role handoff.
3. **Worker removed from both compose files**, not just `render.yaml` — full
   parity, one code path everywhere. Restoration is a git-history copy-back.
4. **B-02 revert documented here + RUNBOOK note.** The original audit report
   stays immutable.

## Architecture

```
Before (deployed topology)              After (beta topology)
  crux-api  (web, free)                   crux-api (web, free)
  crux-worker (worker, starter) ----->      └─ ingest loop thread (daemon)
       both poll documents table               same claim/poll code, in-process
```

- Queue semantics unchanged: `documents` row is the job record, atomic
  `pending -> processing` claim via `FOR UPDATE SKIP LOCKED`, idempotent
  re-runs, periodic `recover_stuck` reclaim.
- `python -m worker` still works unchanged for local debugging or future
  scale-out.

## Changes

1. **`backend/worker.py`** — `main_loop(max_iterations=None, stop_event=None)`.
   A `threading.Event` may be passed; the loop uses `stop_event.wait(POLL_INTERVAL_S)`
   instead of `time.sleep(POLL_INTERVAL_S)` and exits promptly when the event is
   set. When `stop_event` is None (worker mode), behavior is identical to today.
2. **`backend/config.py`** — `ingest_in_process: bool = True` on `Settings`
   (env var `INGEST_IN_PROCESS`), following the existing bool-field pattern
   (`llm_stub`, `debug_timing`).
3. **`backend/main.py`** — lifespan: when `settings.ingest_in_process`, start
   `threading.Thread(target=main_loop, kwargs={"stop_event": ev}, daemon=True)`
   before `yield`; after `yield`, set the event and `thread.join(timeout=5)`.
   A join timeout is acceptable: an ingest abandoned mid-shutdown is reclaimed
   by `recover_stuck` on next boot (idempotent re-run).
4. **`render.yaml`** — delete the `crux-worker` service block.
5. **`docker-compose.yml` / `docker-compose.prod.yml`** — delete the `worker`
   service.
6. **`backend/tests/test_deploy_config.py`** — invert the two worker tests:
   assert the worker service is ABSENT from compose files and `render.yaml`.
   This guards against re-adding a worker without revisiting the flag decision.
7. **New tests** —
   - `main_loop` exits promptly when `stop_event` is set (no full poll-interval
     lag on shutdown).
   - Lifespan starts the ingest thread when the flag is true and does not when
     false (assert via thread presence or a start hook, whichever is cleanest
     with the existing TestClient lifespan handling).
8. **Docs** — this spec, plus a paragraph in `docs/deploy/RUNBOOK.md`: worker
   intentionally deferred, B-02 isolation revert accepted for beta, pointer to
   the scale-out steps below.

## Error handling

- Per-document exceptions are already caught inside the loop; a bad PDF cannot
  kill the thread.
- If the thread itself dies (unexpected), the queue stalls until the next
  restart. Accepted for beta — same failure class as the dedicated worker
  process crashing today. Detection remains "upload stuck in pending", visible
  in the UI. No new handling added.
- Free-tier instance sleep: any doc still pending at spin-down waits until the
  next request wakes the instance. Rare in practice — the uploader is on the
  site when the queue has work.

## Accepted risks (B-02 revert)

- Ingestion CPU (PDF parse + embedding calls) returns to the web process. The
  loop ingests one document at a time, which bounds contention. Latency spikes
  during ingest are accepted at beta load.
- CPU share: the Render free web instance (0.1 CPU) replaces a dedicated
  0.5-CPU worker. Parse runs slower and competes (GIL) with request handling;
  chat streaming may stutter during heavy parse.
- Memory blast radius: PDF parse now spikes RAM inside the web service's
  512 MB. An OOM restarts the whole web service (dropping in-flight chats)
  instead of killing only a worker. Upload caps (25 MB, max_chunks) bound the
  worst case.
- Revisit trigger: real/paying users, ingestion-latency complaints, chat
  stutter correlated with uploads, or more than ~2-3 concurrent uploaders.

## Scale-out restoration (runbook)

1. Restore the `crux-worker` block in `render.yaml` and the `worker` service in
   both compose files from git history (this commit's parent has the exact
   blocks).
2. Set `INGEST_IN_PROCESS=false` on the web service.
3. Re-invert the two deploy-config tests.
4. `SKIP LOCKED` claiming needs no changes for N workers.

## Testing

- Unit: stop-event behavior, flag gating (above).
- Existing `backend/tests/test_worker.py` untouched — worker-mode loop still
  covered.
- Updated `test_deploy_config.py` assertions.
- No new paid smoke: stub-mode upload -> ingest coverage exists; live
  verification folds into the already-owed deploy smokes.

## Out of scope

- Worker heartbeat / auto-detection (rejected, see above).
- Queue-depth monitoring/alerting (post-beta, with real users).
- Any change to ingestion logic, queue schema, or `worker.py` claim semantics.

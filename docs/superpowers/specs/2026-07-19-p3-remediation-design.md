# P3 Remediation — Deferred Findings from Final Adversarial Review (2026-07-19)

## Purpose

Close out all 36 deferred P3 findings from `docs/review/2026-07-18-final-adversarial-review.md` as the polish pass the user requested before resuming the Render/Vercel deploy. Finding IDs below refer to that document; each finding there carries full defect/anchor/trigger detail — this spec records grouping, fix approach, and the four decided structural calls.

## Scope

All 36 P3s: B-03..B-13 (11 backend), F-07..F-20 (14 frontend), I-03..I-11 (9 integration/contract), U-04 (fonts), U-05 (investigate-only). Nothing else — no new features, no refactors beyond the four structural calls below.

## Execution model

Five sequential batches, mirroring the proven adversarial-batch pattern:

- Each batch: own branch `fix/p3-batch-<letter>` off current `dev`, executed via subagent-driven development, TDD per task (regression test proven failing before the fix where feasible), own PR to `dev`, CI green + final code review before merge.
- Next batch branches only after previous batch merges.
- Contract-touching tasks edit `docs/api/openapi.yaml` first, then regenerate with `backend/.venv/Scripts/python backend/scripts/gen_contracts.py` (bare `python` has stale codegen and produces fake drift).
- Any new Alembic migration is gated by the migration-reviewer agent before PR.

## Batch A — Backend concurrency + data integrity (7 findings)

| ID | Fix |
|---|---|
| B-03 | Route agent gap-add through `add_exclusive(profile, "confirmed_gaps", ...)` in `profile_service.apply_patch`, matching the user PATCH path; restores the exclusivity invariant. |
| B-04 | `attach_message_id`: take `lock_session_row` before `get_pending_check`; mutate only `message_id` on the freshly-read dict inside the locked span. |
| B-05 | Migration 0021: partial unique index `uq_sessions_active_topic ON sessions (user_id, lower(topic)) WHERE ended_at IS NULL`; map IntegrityError on create to the existing 409 `duplicate_topic` payload. |
| B-06 | `update_session`: when renaming an active session, run `_active_session_on_topic(..., exclude_id=row.id)` and 409 on hit (same payload as create). |
| B-11 | Same migration 0021: plain index `ix_sessions_user_id`. |
| B-12 | `register()`: `lock_session_row` before the open-batch guard. |
| B-13 | `merge_into_session`: fetch row `with_for_update=True` (no-op on SQLite, serializes on Postgres). |

One migration (0021) carries both B-05 and B-11 indexes. All locking follows the existing F-24 `lock_session_row` convention — no new mechanisms.

## Batch B — Backend cost/perf/pool (4 findings)

| ID | Fix |
|---|---|
| B-07 | Reorder `/upload`: extension check → session-ownership 404 → `check_and_increment` → size/magic/write. Ownership-before-increment also removes the fresh-user FK 500. |
| B-08 | `_prepare_turn` except arm: track metered embedding cost in a holder (ingestion `cost_holder` pattern) and re-`record_cost` after rollback, before the user-message commit. |
| B-09 | `semantic_fallback_required` returns `(required, query_vec)`; thread the vector into `prefetch_for_prompt` so the same query is embedded once. |
| B-10 | **Structural (decided):** two parts. (1) `create_engine(..., pool_pre_ping=True, pool_size=..., max_overflow=...)` sized to Render free instance + Supabase pooler limits. (2) Refactor the tutor loop so the transaction is committed/rolled back before each `await litellm.acompletion(..., stream=True)`, returning the connection to the pool for the stream duration — removes the ~15 concurrent-stream ceiling rather than raising it. |

B-10 part 2 touches `agent/tutor.py` transaction flow; its tasks must assert post-stream reads reopen a transaction correctly and existing tool-dispatch commits still hold.

## Batch C — Frontend resilience + state correctness (9 findings)

| ID | Fix |
|---|---|
| F-07 | **Light structural (decided):** background session actions (rename/pin/end-from-sidebar) stop writing the global `store.error` — failures surface via toast; Home's fatal error branch scoped to its own load (`store.error && !store.sessions.length`). |
| F-11 | Onboarding submit + Settings save: `submitting` ref disables button in flight; try/catch with inline error line (LoginView pattern). |
| F-12 | `uploadDocument`: `AbortSignal.timeout(120000)` + one 401 refresh-retry via `_refreshAccessToken()`. |
| F-13 | `loadSession` finally-arm clears `loading`/`detailLoading` only when `_latestRequestedId === id`. |
| F-14 | Wrap `auth.init()` in try/catch inside `bootstrap()`; on failure proceed unauthenticated (guard routes to /login); app always mounts. |
| F-15 | Library `load()`: module-level seq guard (`_latestRequestedId` idiom); discard stale writes. |
| F-16 | `_onAuthExpired` pushes login with `query: { redirect: router.currentRoute.value.fullPath }`. |
| F-17 | `completeCheck`: clear `pendingCheck` only after the completion stream is underway (first event or post-header resolve); restore it in the network-failure catch. |
| F-20 | Check-flow API calls SessionView already banners (`answerCheck`/`skipCheck`) adopt the `silent: true` profileApi pattern to stop double-surfacing. |

## Batch D — Frontend a11y + visual (6 findings)

| ID | Fix |
|---|---|
| F-08 | `router.afterEach` focuses `#main-content` (`tabindex="-1"`) on push navigations. |
| F-09 | Drop `role="menu"`/`menuitem` from SidebarRowMenu — plain buttons in a labelled group (reviewer's honest-semantics fix; APG rebuild not warranted). |
| F-10 | Swap white-on-raw-signal fills to the base.css darkened recipe; replace `outline: none` focus rules with `outline: 2px solid var(--color-accent-ring)`; tokenize hardcoded hexes (`#2E5DC4` et al.) as token variants. |
| F-18 | Move `aria-live` off the message list to a visually-hidden status region announcing discrete events ("Tutor is replying" / "Reply finished"). |
| F-19 | Extract `.summary-dialog` global chrome rules into shared `.crux-dialog` class applied to both Dialogs. |
| U-04 | Self-host the three Google Fonts families as woff2 assets under `frontend/src/assets/fonts/`; drop the CDN `<link>`s from `index.html`. |

## Batch E — Contract + integration + infra (10 findings)

| ID | Fix |
|---|---|
| I-03 | **Structural (decided): implement the header.** Set `X-Cost-Warning` on `/sessions/{id}/end` and `/upload` responses when soft cap crossed; add `expose_headers=["X-Cost-Warning"]` to CORSMiddleware; fix docstring. FE consumer + tests already exist. |
| I-04 | `friendlyError`: distinguish 429-with-`detail.code` (daily-cap copy) from bare 429 ("Too many requests — wait a moment and retry."). |
| I-05 | `reopenSession` catch: on 409 `duplicate_topic`, set specific error + expose `detail.session_id` for a "Go to active session" action (NewSessionView pattern). |
| I-06 | **Structural (decided): build-time CSP injection.** Vite HTML transform injects a CSP `<meta http-equiv>` whose `connect-src` derives from `VITE_API_BASE_URL` origin (+ Supabase); remove the CSP header (and its `https://CRUX_API_HOST` placeholder) from `vercel.json`. Preview deploys and fresh clones work without a manual commit. Note: meta CSP cannot carry `frame-ancestors` — if that directive is needed it stays a header; verify during implementation. |
| I-07 | Add `ENV: prod` to `docker-compose.prod.yml` environment (and explicit `ENV: dev` in `docker-compose.yml` for symmetry). |
| I-08 | Add `check_question` (gap, total, items[{question, options}]) and `followup_skipped` (reason) to `x-sse-events` in openapi.yaml. |
| I-09 | Document 415 on `/upload` in YAML; `onAttachFile` catch surfaces `e.body?.detail?.message` when present. |
| I-10 | Composer textarea `maxlength="4000"` + character counter near limit; pop the optimistic user bubble on non-retryable send failure. |
| I-11 | Shared `Unauthorized` (401) response referenced by all auth'd paths; 503 on auth-touching paths; 422 on profile PATCH; reference or delete orphaned `UpstreamUnavailable`. |
| U-05 | Timeboxed investigate-only task (transient generic toast on app load, unreproduced). If no reproduction/root cause within the timebox, close as unreproducible with notes. |

## Error handling / testing

- Every code fix lands with a test that failed before the fix (stash-verify), matching prior batch discipline. Concurrency fixes (B-04/05/12/13) test via the same two-session/interleave harnesses used by F-24-era tests where a true race can't be forced deterministically.
- B-10 part 2 gets a regression test asserting no open transaction is held at the `acompletion` call boundary (inspectable via session/connection state in test double).
- I-06 gets a build-output assertion (built `index.html` contains the meta CSP with the env-derived origin).
- Batches A/B: full backend suite. C/D: full frontend suite + lint. E: both + contracts drift check.

## Out of scope

- P1/P2 findings (all fixed in PR #132).
- Phase 5 screencast, deploy resume (RUNBOOK), R5 practice-exam mode.
- Any refactor beyond the four decided structural calls (B-10 stream-release, F-07 error scoping, I-03 header implementation, I-06 CSP injection).

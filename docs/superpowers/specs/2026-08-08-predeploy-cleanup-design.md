# Pre-Deploy Cleanup Batch — Design

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
**Source findings:** QA audit 2026-08-06 (`docs/reviews/2026-08-06-qa-audit/`) — F-9 (E-05/E-11/E-14), Q-04, C-12, and open verification gates W-09, W-06, W-11, W-12.

## Goal

Close every remaining pre-deploy-closable item from the QA audit in one batch: one
frontend bugfix cluster, one CI coverage-scope fix, one migration convention, then the
four local verification gates. Everything that requires a live deployment stays out of
scope (W-01/03/04/05/15, deployed-log observation, worker kill/resume, W-08, W-13).

## Workstream 1 — F-9: user input is never silently destroyed

**Root cause (shared by E-05 and E-11):** two error arms in
`frontend/src/stores/session.js` resolve (`return`) instead of throwing, so
`SessionView.send()` runs its success path, clears `lastSentText`, and never restores
`draft`.

### Changes

1. **Typed error.** Add `StreamAbortedError` to `frontend/src/lib/errors.js` with a
   `reason` field: `'auth_expired' | 'session_ended'`.
2. **`stores/session.js` catch arm (~:869-874).** Distinguish why `_streamSuperseded()`
   is true:
   - Genuine navigation supersede (user opened another session / left intentionally):
     keep the silent `return`. Restoring a draft here would be wrong.
   - Reset caused by sign-out (auth expiry): perform existing cleanup, then **throw**
     `StreamAbortedError('auth_expired')`.
3. **`stores/session.js` 409 `session_ended` arm (~:888-895).** Keep the banner and
   ended-state handling, then **throw** `StreamAbortedError('session_ended')` instead of
   returning.
4. **`SessionView.vue` send() catch (~:591-607).** On `StreamAbortedError`:
   - restore `draft.value = text`;
   - for `session_ended`, skip the generic error chip (the store banner already
     explains); for `auth_expired`, also stash the draft (next item).
5. **E-05 login round-trip.** Sign-out redirects to `/login` and component state dies,
   so an in-memory restore is not enough. On `auth_expired`, persist
   `{ sessionId, text }` to **`sessionStorage`** (key e.g. `crux:draft:<sessionId>`).
   On `SessionView` mount, if a stashed draft exists for the current session, restore it
   into the composer and remove the key. Dies with the tab; no stale-draft cleanup
   needed beyond the remove-on-restore.
6. **E-14 retry clobber.** `SessionView.vue retryLastMessage()` (~:609-613): send
   `draft.value` when non-empty, falling back to `lastSentText` only when the composer
   is empty.

### Tests (vitest)

- 401-mid-send (auth expiry) → draft stashed to sessionStorage; remount restores it.
- 409 `session_ended` → draft restored in composer, banner shown, no generic chip.
- Retry after editing the failed message → edited text is sent.
- Genuine navigation supersede → silent, no draft restore, no error surfaced.

## Workstream 2 — Q-04: coverage floor scope

`backend/pyproject.toml:49-50` currently measures only `services/` and `lib/`.

**Change:** add `--cov=routes --cov=agent --cov=db` to `addopts`, keep
`--cov-fail-under=75`.

**Budget rule (agreed):** measure first, then decide. Run the suite once with the new
scope and report the number:

- Measured ≥ 75 → done.
- Measured in (65, 75) → write tests for the largest uncovered gaps until ≥ 75, in this
  batch.
- Measured ≤ 65 → **stop and ask the user**: write tests now vs. ratchet the floor to
  the measured value. No blind commitment to days of test-writing.

## Workstream 3 — C-12: migration locking convention

Forward-guidance only; the three offending migrations (0017/0019/0021) are applied live
and are not rolled back.

**Change:** add a locking section to the `migration-reviewer` agent checklist
(`.claude/agents/migration-reviewer.md`), which the repo already enforces via hook:

- Index builds on populated/hot tables: `with op.get_context().autocommit_block():`
  wrapping `op.execute("CREATE INDEX CONCURRENTLY ...")`.
- CHECK constraints: two-step `ADD CONSTRAINT ... NOT VALID` then
  `VALIDATE CONSTRAINT`.
- Any migration touching a hot table: `SET lock_timeout = '5s'` at the top.

Mirror one summary line in the `project-conventions` skill if it has a migrations
section.

## Workstream 4 — local verification gates (post-merge, same session)

Run in this order; each result recorded in
`docs/reviews/2026-08-06-qa-audit/deployment-checklist.md` and the gate flipped.

1. **W-09** — rebuild local docker images (stale since 2026-07-18):
   `docker compose build --no-cache`, then `docker compose up` sanity.
2. **W-06** — clean-clone compose smoke: clone repo to a scratch directory; **user
   places `.env` files manually** (never-read-.env rule; no key handling by Claude);
   then `docker compose up` — containers healthy, frontend serves, backend health OK,
   upload path exercised (this is the gate that would have caught C-02).
3. **W-11** — narrow-viewport settings rail: browser at ~500 px width, confirm the
   settings rail scrolls (code-read says PASS; gate owed as a visual check).
4. **W-12** — glance-stats post-merge visual pass in the browser.

**Failure rule:** any gate FAIL → stop, report, fix as a separate follow-up (ground
rules: stop and report on any failed verification step).

## Out of scope

- W-13 owed paid smokes (accepted closed-beta risk).
- E-12 (End-session confirm) and E-13 (raw Supabase error strings) — not part of F-9.
- Draft queue-and-auto-send after re-login (restore only, no auto-send).
- Deploy-dependent gates: W-01/03/04/05/15, W-08, deployed-log observation, worker
  kill/resume smoke, prod nginx smoke.

## Delivery

Branch `fix/predeploy-cleanup-f9-q04-c12` off `dev`; one PR. Workstream 4 runs after
merge in the same session, then the deployment checklist is updated and committed.

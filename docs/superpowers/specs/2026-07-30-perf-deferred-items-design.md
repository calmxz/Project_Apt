# Perf Deferred Items: Transcript Pagination, Route Progress Bar, Idle Badge Fetch

Date: 2026-07-30
Status: Approved design, pending implementation plan
Origin: deferred items from the PR #179 performance audit. Item numbering below
matches that audit. Item 1 (Render free-tier cold start) is explicitly
deferred again — no live deployment exists yet; the decision (paid plan vs
keep-alive ping) goes on the deploy checklist in `docs/deploy/RUNBOOK.md`,
not in this spec.

## Scope

Three independent changes, one branch:

- **Item 2** — paginate the session transcript (API contract change + backend
  + frontend "Load earlier" affordance).
- **Item 3** — top-of-viewport route-transition progress bar (frontend only).
- **Item 4** — defer the sidebar review-queue badge fetch off the boot
  critical path via `requestIdleCallback` (frontend only).

Out of scope: Render cold start (item 1), async-loading the Sidebar chunk on
public routes, nginx brotli/immutable headers, virtual scrolling.

## Item 2 — Session transcript pagination (cursor)

### Problem

`GET /api/sessions/{session_id}` returns every message in the session,
unpaginated. A long session produces a large payload and N synchronous
markdown-it / hljs / DOMPurify parses on the main thread when the view opens.

### API contract (edit `docs/api/openapi.yaml` first, then run codegen)

1. `GET /api/sessions/{session_id}` (existing):
   - `messages` now contains only the **last 30** messages of the session,
     in ascending (chronological) order — unchanged shape, capped count.
   - `SessionDetail` gains a required field `has_more_messages: boolean` —
     `true` when older messages exist beyond the returned window.
2. `GET /api/sessions/{session_id}/messages` (new):
   - Query params: `before` (integer, required — a message `id` acting as an
     exclusive cursor) and `limit` (integer, optional, default 30, max 100,
     `ge=1`).
   - Response schema `MessagePage`:
     - `items`: array of `Message`, ascending chronological order.
     - `has_more`: boolean — `true` when messages older than the returned
       page exist.
   - Errors: 404 for unknown session or a session owned by another user
     (same ownership guard as the session detail route); 422 for a
     malformed/missing cursor (FastAPI validation).
   - A `before` cursor older than every message returns an empty `items`
     with `has_more: false` (not an error).

The cursor is the message integer primary key. Message ids are monotonic
within a session, so `id < before` pages are stable while new messages
append at the tail — no duplicate/gap drift, which is why cursor was chosen
over offset/limit.

### Backend

- Session detail query: fetch newest 30 via
  `WHERE session_id = :id ORDER BY id DESC LIMIT 31`, reverse in Python.
  The 31st row is a probe: its presence sets `has_more_messages = true` and
  it is dropped from the payload. No separate `COUNT(*)`.
- Messages page query: same shape with an added `AND id < :before`.
- Existing index `ix_chat_messages_session_created (session_id, created_at)`
  narrows both queries to one session's rows; the `ORDER BY id` sort on that
  narrowed set is cheap at chat-transcript scale. No migration expected; if
  the implementer decides a `(session_id, id)` composite index is warranted,
  that is a plan-level decision and any migration must go through the
  migration-reviewer agent.

### Frontend

- SessionView: when `has_more_messages` is true, render a "Load earlier
  messages" button pinned at the top of the transcript.
- On click: call the new endpoint with `before` = the id of the oldest
  currently-loaded message; prepend `items` to the message list.
- Scroll preservation: record the scroll container's `scrollHeight` before
  prepend, restore `scrollTop += (newScrollHeight - oldScrollHeight)` after
  DOM update (`nextTick`), so the viewport does not jump.
- Button carries its own pending (spinner/disabled) and inline error states.
  Fetch failures do not toast (pass `silent`); the button shows a retryable
  error label instead.
- Button hides when the returned page has `has_more: false`.

### Tail-state safety (design constraint — do not "optimize")

Resume logic derives state from the **tail** of the transcript: open
check-batch detection, recap cards, diagnostic detection, and
`pending_check` reconciliation. The last-30 window always includes the tail,
so this logic is untouched. Older pages loaded via "Load earlier" are
display-only history: prepending them must not re-run open-batch detection
or any other state derivation. Recap cards for resolved batches inside older
pages render normally (they are self-contained per message).

### Tests

- Backend: window of exactly 30 vs 31 messages (has_more flips), empty
  session, page boundaries (`before` mid-transcript, `before` at oldest,
  `before` past oldest → empty + `has_more: false`), foreign-user session →
  404, missing/garbage `before` → 422, `limit` clamp.
- Frontend: button renders only when `has_more_messages`; click prepends in
  correct order; scroll position preserved; pending and error states; button
  disappears at history exhaustion; open-batch detection unaffected by
  prepended pages.
- Contract: codegen produces zero drift (CI-enforced).

## Item 3 — Route-transition progress bar

### Problem

Lazy route chunks load with no pending UI. During chunk fetch the old view
sits static, reading as a dead click.

### Design

- New `frontend/src/services/routeProgress.js`: a small reactive state
  module (Vue `reactive`/`ref`, no Pinia) exposing `visible`, `progress`,
  and `start()` / `finish()` / `fail()`. No external library — nprogress is
  not worth a dependency for ~40 lines.
- Router wiring in `frontend/src/router/index.js`:
  - `beforeEach`: arm a 150 ms timer; the bar becomes visible only if the
    navigation has not settled by then (no flash on instant navigations).
  - `afterEach`: cancel the timer; if the bar is visible, jump to 100% and
    fade out.
  - `onError`: same teardown as `afterEach` (hide the bar; the navigation
    failure surfaces through existing error handling, not through the bar).
- New `frontend/src/components/RouteProgressBar.vue`: fixed at the top of
  the viewport, 3 px tall, accent coral, `aria-hidden="true"` (purely
  decorative; route change is announced by the destination view). While
  pending it trickles toward ~85% via CSS transition and completes to 100%
  on finish. Honors `prefers-reduced-motion` (no trickle animation; simple
  appear/disappear).
- Rendered once at the top level of `App.vue`, outside the `showShell`
  branch, so it covers both shell and public routes.

### Tests

- routeProgress state machine: start does not show before 150 ms; shows
  after; finish before threshold never shows; finish/fail while visible
  completes and hides; overlapping navigations reset cleanly (use fake
  timers).
- Component: renders/hides on state; width tracks `progress`.

## Item 4 — Sidebar badge fetch off the boot path

### Problem

`Sidebar.vue` `onMounted` fires `getReviewQueue({limit: 1})` during boot.
The server-side N+1 was already fixed (PR #178/#179 work), but the request
still competes with first-paint-critical work.

### Design

- Wrap the badge fetch in `requestIdleCallback`, falling back to
  `setTimeout(cb, 200)` where `requestIdleCallback` is unavailable (older
  Safari). Extract a tiny `runWhenIdle(cb)` helper (module-local in
  `Sidebar.vue` or a shared util if one exists — plan decides).
- Inside the callback, guard before fetching: skip if the component has
  unmounted (flag set in `onBeforeUnmount`) or `isAuthenticated` has become
  false.
- Everything else unchanged: fetch stays silent (never toasts), badge shows
  whenever the response lands — typically well under a second later.

### Tests

- Adapt the existing sidebar badge test: mock `requestIdleCallback` to fire
  synchronously and assert the badge still populates.
- Fetch does not fire before the idle callback runs.
- Callback after unmount does not fetch.
- Fallback path: with `requestIdleCallback` undefined, `setTimeout` path
  fetches.

## Error handling summary

- Item 2: new endpoint uses existing auth + ownership guards; FE button has
  inline retry, no toast.
- Item 3: `router.onError` tears the bar down; the bar never reports errors
  itself.
- Item 4: unchanged silent-failure semantics.

## Rollout

Single branch off `dev` (`feat/perf-deferred-2-3-4` or similar per branch
conventions), one PR. No feature flags, no migration expected, no
environment changes. Contract codegen must be run and committed with the
YAML edit.

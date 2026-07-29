# Sidebar Session Cap + All Sessions Lazy Loading — Design

Date: 2026-07-29
Status: Approved
Branch: `feat/sidebar-cap-lazy-sessions` (off `dev`)

## Problem

Session count is unbounded and monotonically increasing (topic revisits end the prior
session and create a successor; there is no session delete endpoint). The sidebar
fetches every session via unpaginated `GET /api/sessions` and renders every row.
Meanwhile a fully built, tested, paginated "All sessions" page
(`SessionsLibraryView.vue`, route `/sessions`, `GET /api/sessions/library`) exists but
is orphaned — nothing in the app links to it.

## Decisions (locked with user)

1. Sidebar shows the **20 most recent** rows per tab, and the fetch itself is capped
   **server-side**: the sidebar data path moves off unpaginated `GET /sessions` onto
   the paginated library endpoint (decision upgraded 2026-07-29 from an initial
   render-cap-only design).
2. "View all" opens the **dedicated page** at `/sessions`.
3. The page keeps its **title search** (already built, server-side `q`).
4. The page's prev/next pager is replaced with **infinite scroll**
   (IntersectionObserver sentinel, append-per-page).

## 1. Store data path (`frontend/src/stores/session.js`)

- Reimplement `listSessions()` over the library endpoint: two fetches —
  `GET /sessions/library?status=active&sort=pinned_activity&limit=20` and
  `GET /sessions/library?status=ended&sort=last_activity&limit=20` — merged into the
  **existing** `sessions` array (dedupe by id). Both consumers (Sidebar, HomeView)
  share this one action, so there is a single writer for the array.
- Rationale: grouping, pinning, tabs, and all optimistic mutations (rename / pin /
  end / reopen, ~10 call sites) operate client-side on that same array by id/index —
  they keep working unchanged. Ending a session sets `ended_at` and it moves groups
  client-side.
- Store gains `activeTotal` / `endedTotal` refs from the two responses' `total`
  fields; these drive "View all N" labels and link visibility.
- The `_inflight` de-dupe map keeps de-duplicating concurrent `listSessions()` calls
  (key covers the new request shape).
- `GET /api/sessions` remains in the backend and contract but is no longer called by
  the app. **Implementation-time audit required:** verify HomeView needs nothing
  beyond the merged top-20 active + top-20 ended set; if it does, surface before
  proceeding.

## 2. Sidebar (`frontend/src/components/sidebar/Sidebar.vue`, `useSessionGroups.js`)

- Renders from the same store array as today; render cap of 20 rows per status tab as
  a safety net (client-side mutations can temporarily push a group past 20):
  - Active tab: pinned rows first (server already ordered pinned-first) and count
    toward the 20.
  - Ended tab: flat recency slice of 20.
- When the current tab's server `total` exceeds the rendered count, render a
  "View all N sessions" link below the list (pattern precedent: `ReviewView.vue`
  "View all {{ total }}"). Link target: `/sessions?status=active` or `?status=ended`
  matching the current tab.
- **Sidebar search goes server-side:** typing in the sidebar search fires a debounced
  `GET /sessions/library?q=...&limit=20` (status matching the current tab); results
  render flat, capped at 20, with a "View all" link carrying the query
  (`/sessions?status=...&q=...`). Clearing the search restores the normal tab view
  from the store array. Search results live in local sidebar state — they must not
  overwrite the store `sessions` array. Stale-response guard required (same pattern
  as the page's F-15 guard).

## 3. All Sessions page (`frontend/src/views/SessionsLibraryView.vue`)

- Remove the prev/next pager and range label.
- Items become an accumulating array: each page fetch **appends**; `offset += limit`
  per page (limit stays 20).
- An IntersectionObserver watches a sentinel element after the list; when it nears the
  viewport and `items.length < total` and no fetch is in flight, fetch the next page.
  Observer logic lives in a small composable (`useInfiniteScroll` or inline) — no repo
  precedent exists, keep it minimal.
- Any filter/search/sort change: reset `offset = 0`, **clear** the items array,
  refetch (reuse the existing reset-on-change logic). The existing F-15 stale-response
  race guard must be preserved — it is now more critical because responses append into
  a shared array.
- Sentinel row doubles as status UI: loading spinner while fetching; on fetch error,
  inline error message + "Retry" button (observer paused while errored — no automatic
  retry loop).
- On mount, initialize the status filter — and search query — from the route query
  (`?status=`, `?q=`), falling back to current defaults.
- Title search: no change (server-side `q` already wired).

## 4. Backend / contract

One small change: add sort option **`pinned_activity`** to
`GET /api/sessions/library` — orders pinned first, then by last activity (both
descending), reusing the existing `last_activity` coalesce subquery. Ensures pinned
sessions always land inside the sidebar's top-20 active fetch (assumes < 20 pinned;
beyond that, overflow pinned rows are cut — acceptable).

Contract discipline: edit `docs/api/openapi.yaml` first (extend the `sort` enum),
then run `python backend/scripts/gen_contracts.py`. No migration.

## 5. Testing

- Backend (pytest): `pinned_activity` sort — pinned-first ordering, tie-break by
  activity, interaction with `status` / `limit`.
- Store: `listSessions()` merge — two pages merged deduped, totals set, `_inflight`
  de-dupe still works, optimistic mutations still patch the merged array.
- Sidebar (vitest): renders at most 20 rows per tab; "View all" hidden when
  `total <= rendered`, visible above with correct total and query params; server-side
  search — debounce, results capped, stale-response guard, store array untouched,
  clear restores tab view.
- Library page: IntersectionObserver mocked via a small test helper (no repo
  precedent); cover — append on intersect, no fetch once `items.length >= total`,
  filter/search/sort change clears list and resets offset, error shows retry and
  retry resumes, stale-response race guard still holds, `?q=`/`?status=` init from
  route. Existing pager tests are deleted or rewritten to the new model.

## Out of scope

- Removing `GET /api/sessions` from the backend/contract (app stops calling it; the
  endpoint itself is untouched — deprecate separately if ever).
- Virtual scrolling.
- Session deletion / cleanup.

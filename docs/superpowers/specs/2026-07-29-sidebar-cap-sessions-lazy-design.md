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

1. Sidebar shows the **20 most recent** rows per tab; cap is a **render cap** — the
   fetch stays unpaginated (`GET /sessions`, all rows). Zero backend/contract change.
2. "View all" opens the **dedicated page** at `/sessions`.
3. The page keeps its **title search** (already built, server-side `q`).
4. The page's prev/next pager is replaced with **infinite scroll**
   (IntersectionObserver sentinel, append-per-page).

## 1. Sidebar (`frontend/src/components/sidebar/Sidebar.vue`, `useSessionGroups.js`)

- Fetch unchanged. After existing grouping/sorting, render only the 20 newest rows in
  the current status tab:
  - Active tab: pinned rows render first and count toward the 20.
  - Ended tab: flat recency slice of 20.
- When the current tab's total exceeds 20, render a "View all N sessions" link below
  the list (pattern precedent: `ReviewView.vue` "View all {{ total }}"). Link target:
  `/sessions?status=active` or `?status=ended` matching the current tab.
- Sidebar search unchanged: still filters the full loaded set client-side; its results
  are also capped at 20 with the same "View all" link. Full-corpus search lives on the
  page.

## 2. All Sessions page (`frontend/src/views/SessionsLibraryView.vue`)

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
- On mount, initialize the status filter from the route query (`?status=`), falling
  back to the current default.
- Title search: no change (server-side `q` already wired).

## 3. Backend / contract

No changes. `GET /api/sessions/library` (`limit/offset/q/status/sort`) and its OpenAPI
contract already fit. No migration.

## 4. Testing (vitest)

- Sidebar: renders at most 20 rows per tab; "View all" hidden at <= 20, visible above
  20 with correct total and query param; capped search case.
- Library page: IntersectionObserver mocked via a small test helper (no repo
  precedent); cover — append on intersect, no fetch once `items.length >= total`,
  filter/search/sort change clears list and resets offset, error shows retry and
  retry resumes, stale-response race guard still holds. Existing pager tests are
  deleted or rewritten to the new model.

## Out of scope

- Server-side sidebar limit (payload growth deferred; revisit if session counts hurt).
- Virtual scrolling.
- Session deletion / cleanup.
- Any change to sidebar search behavior beyond the render cap.

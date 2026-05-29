# Home Recent-Activity Feed — Design — 2026-05-29

**Companion to:** [`docs/ui-sidebar-refactor-spec.md`](../../ui-sidebar-refactor-spec.md).
**Branch:** `feat/sidebar-shell` (current) or a follow-up branch off it.

## Problem

After the sidebar refactor (S5), `HomeView` was simplified to a welcome page: header + lede + duplicate banner + a top-right `New session` CTA. When sessions exist, the body below the header is empty — the sidebar owns the session list. The empty main column reads as abandoned rather than intentional.

The sidebar owns *navigation*. The main screen should own something the sidebar cannot show well: a **recent-activity feed** that gives each recent session context (what was covered) rather than a bare nav label.

## Decision

Split responsibilities cleanly:

| Surface | Owns |
|---|---|
| **Sidebar** | Persistent session navigation — full active/ended list, jump between sessions. Unchanged by this spec. |
| **Main (`HomeView`)** | Welcome header + recent-activity feed — the 5 most-recent sessions, newest first, each with a one-line summary snippet. |

The feed is **not** a duplicate of the sidebar list because each row carries `last_session_summary` (what happened that session) and is ordered strictly by recency. Sidebar rows are bare topic labels grouped active/ended; feed rows are contextual and chronological. Both click through to the session.

### Locked decisions

| # | Question | Decision |
|---|---|---|
| 1 | Feed row content | Topic + active/ended dot + relative time + 2-line-clamped `last_session_summary` snippet + arrow. |
| 2 | Backend change | **Yes, contract-first.** Add `last_session_summary` to `RecentSessionSummary`. Sidebar spec's "no backend changes" rule does not apply — this is a separate feature. |
| 3 | Data source | Reuse `GET /profile/aggregate` (`getAggregateProfile()`), already returning `recent_topics`. Single fetch. |
| 4 | Feed length | Capped at 5 (backend already slices `sessions[-5:]`). Sidebar holds the full list. The cap is intentional and matches "recent". |
| 5 | Active session with no summary | Fallback row copy: *"In progress — pick up where you left off."* (`last_session_summary` is only set on session end.) |
| 6 | Layout | Feed renders below the header; the `New session` CTA moves to a centered card **below the feed** (matches the sidebar-spec sketch). The feed is the page focus; the CTA closes the page. |
| 7 | Empty state (zero sessions) | Existing `EmptyState` unchanged. No feed renders. |
| 8 | Styling | Reuse the `.recent-*` row styles already proven in `AggregateProfileView.vue`. No new design tokens. |

## Layout

```
  your shelf
  Sessions
  3 active sessions. Pick one from the sidebar, or start a new one.

  ⚠ 1 duplicate active session detected. ...        [Clean up]    ← existing dupe banner (gated)

  RECENT ACTIVITY
  ┌────────────────────────────────────────────────────────┐
  │ ● Big-O notation                          2 days ago    │
  │   Covered amortized analysis; gap found in              │
  │   logarithmic bounds.                              →    │
  ├────────────────────────────────────────────────────────┤
  │ ○ Binary trees                            4 hours ago   │
  │   In progress — pick up where you left off.        →    │   ← active, no summary
  └────────────────────────────────────────────────────────┘

              ┌──────────────────────────────┐
              │   New session  +             │                  ← centered CTA below feed
              └──────────────────────────────┘
```

Order in the template: header → dupe banner (gated) → recent-activity feed (when sessions exist) OR `EmptyState` (when zero sessions) → centered CTA card.

## Changes by layer

Contract-first per `CLAUDE.md` source-of-truth discipline.

### 1. Contract — `docs/api/openapi.yaml`

Add to `RecentSessionSummary`:

```yaml
last_session_summary:
  type: [string, "null"]
  default: null
```

Then regenerate: `python backend/scripts/gen_contracts.py`. CI enforces zero drift between YAML and `backend/contracts/models.py`.

### 2. Backend — `backend/services/profile_service.py`

In `aggregate_for_user`, the `recent_topics` comprehension (~line 190) gains one field:

```python
RecentSessionSummary(
    id=s.id,
    topic=s.topic or "",
    created_at=s.created_at,
    ended_at=s.ended_at,
    last_session_summary=(
        s.topic_profile.last_session_summary if s.topic_profile else None
    ),
)
```

(Verify the exact `topic_profile` access shape against the ORM model during implementation — JSON column vs. relationship.)

Extend `backend/tests/test_profile_aggregate.py::test_aggregate_event_count_and_recent_topics` (or add a sibling test) to assert `last_session_summary` is populated for an ended session and `null` for an active one.

### 3. Frontend — `frontend/src/views/HomeView.vue`

- On mount, call `getAggregateProfile()` (from `services/profileApi.js`). Keep the existing duplicate-detection logic — it still needs the session list; decide during implementation whether to keep `listSessions()` alongside or derive dupes differently. Simplest: keep both calls (`listSessions` for dupe logic, `getAggregateProfile` for the feed).
- Add a "Recent activity" section (label uses existing `.label`/`folio` styling) rendering `recent_topics`. Each row:
  - active/ended marker dot (`ended_at` null → active `●`, else `○`)
  - topic (display font, truncated)
  - `formatRelative(created_at)` — reuse existing util
  - `last_session_summary` clamped to 2 lines (`-webkit-line-clamp: 2`); when null/empty, render the muted fallback line from decision #5
  - trailing arrow
  - click → `router.push({ name: 'session', params: { id } })` (confirm router name during implementation)
- Move the `New session` CTA out of the header into a centered card below the feed.
- Reuse `.recent-row` / `.recent-link` / `.recent-topic` / `.recent-when` / `.recent-arrow` styles from `AggregateProfileView.vue` (copy into `HomeView` scoped styles or lift to a shared component if duplication is meaningful).
- `EmptyState` (zero sessions) unchanged.

### 4. Tests — `frontend/src/__tests__/homeView.test.js`

Add/adjust:
- Feed renders one row per `recent_topics` entry.
- Row shows summary snippet when present; shows fallback copy when `last_session_summary` is null.
- Clicking a row navigates to the session route.
- Zero sessions → no feed, `EmptyState` shown.
- Keep existing: loading, error (friendlyError), dupe banner, cleanup, CTA navigates.
- Mock `getAggregateProfile` in the test setup.

## Non-goals

- No new feed for learning events (the per-event timeline stays in `ProfileView`/`AggregateProfileView`).
- No per-session mini-stats on rows (mastered/gap counts) — that was a rejected option.
- No change to the sidebar, its session list, or its row menu.
- No pagination / infinite scroll — the 5-row cap stands.

## Acceptance checks

- Home with ≥1 ended session: feed shows that session with its summary snippet, newest first.
- Home with only active sessions: feed shows rows with the "In progress" fallback line.
- Home with zero sessions: no feed, `EmptyState` + first-session CTA only.
- Clicking a feed row opens `/session/:id`.
- `New session` CTA sits centered below the feed and navigates to the new-session route.
- `python backend/scripts/gen_contracts.py` produces no diff after the YAML edit (contracts in sync).
- `pytest` (backend) and `npm run test:unit -- --run` (frontend) green.
- `npm run lint` clean.
```

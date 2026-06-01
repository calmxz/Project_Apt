# Sidebar Redesign — Design

Date: 2026-05-30
Status: Approved (brainstorming), pending implementation plan
Branch: `feat/sidebar-redesign` (off `dev`)
Scope: net-new, outside the numbered Phase 7 plan (acknowledged by project owner)

## Goal

Evolve the session sidebar from a flat list into a scannable, capable navigator while
preserving the existing coral design language, the WCAG AA accent work merged in #49,
keyboard/focus behavior, and existing `data-testid` contracts.

Four user-requested features land on top of a visual refresh:

1. Search / filter sessions (frontend-only)
2. Date grouping of active sessions (frontend-only)
3. Pin / favorite (backend-backed)
4. Rename session (backend-backed)

## Delivery Approach (Approach C)

One spec, two plan tiers split by data-dependency. Each tier is independently
reviewable and shippable.

- **Tier 1 — frontend-only, zero contract/migration risk:** visual evolve, search box,
  date grouping, collapsed-rail rework, footer-rail rework.
- **Tier 2 — backend-backed:** rename (`PATCH /sessions/{id}`) and pin (new `pinned`
  column). Touches `openapi.yaml` -> codegen -> Alembic -> contract-drift CI.

If the 7-week public deadline tightens, Tier 2 may be dropped and Tier 1 still ships
complete value.

## List Ordering (locked)

Three sort keys (pin, date-group, active/ended) collide. Resolution:

- **Search active** -> flat filtered list across active + ended sessions; pinned grouping
  and date grouping are suppressed; a match count is shown. Empty result shows a
  "No sessions match" hint.
- **No search:**
  1. **Pinned** — mini-group at the top of Active (pin glyph + `(n)` count badge, same
     styling as section labels). Active sessions only; ended sessions cannot be pinned.
  2. **Active (unpinned)** — date-grouped by `created_at`: **Today** / **This week**
     (last 7 days excluding today) / **Older**. Empty buckets are not rendered.
  3. **Ended** — own collapsed section at the bottom. Unchanged behavior: auto-collapse
     when more than 5 ended sessions, otherwise open.

Pin applies only to active sessions. Rename applies to both active and ended sessions.

## Architecture

### New composable: `frontend/src/composables/useSessionGroups.js`

Pure function of inputs, no DOM, fully unit-testable. Owns all list logic so
`Sidebar.vue` stays a thin renderer.

- **Inputs:** `sessions` (ref/array), `searchQuery` (ref), `now` (injectable timestamp
  for deterministic date-bucket tests).
- **Outputs (computed):**
  - `searching: boolean`
  - `filteredFlat: Session[]` — used when `searching`
  - `pinnedActive: Session[]`
  - `activeGroups: { key: 'today'|'week'|'older', label: string, rows: Session[] }[]`
    (empty groups omitted)
  - `endedRows: Session[]`
  - `matchCount: number`
- **Date bucketing:** compare `created_at` against `now`. Today = same calendar day;
  This week = within the prior 7 days but not today; Older = everything else. Boundary
  cases (midnight, exactly 7 days) are pinned down by unit tests using the injected `now`.
- **Filter:** case-insensitive substring match on `topic` (untitled sessions match the
  literal "untitled"). Trimmed; empty query => not searching.

### `frontend/src/components/sidebar/Sidebar.vue`

- Adds a search input directly under the New session CTA, above the Active section.
  Hidden in collapsed desktop mode.
- Renders the grouped structure from `useSessionGroups`: Pinned mini-group, date-grouped
  Active groups, Ended section. In search mode renders the flat filtered list with a
  match-count line and empty-result hint.
- Owns the local `searchQuery` ref. Filtering is synchronous (computed); no async/debounce
  needed at this data scale.

### `frontend/src/components/sidebar/SidebarSessionRow.vue`

- Gains an **inline-rename mode**: the topic label is replaced by a text input. Enter or
  blur commits; Escape cancels and restores. The input manages its own focus on entry and
  returns focus to the row trigger on exit.
- Gains a **pin indicator** (small pin glyph) on pinned active rows.
- Optimistic update with rollback on error for both rename and pin (handled in the store;
  the row reflects store state).

### `frontend/src/components/sidebar/SidebarRowMenu.vue`

- Adds menu items:
  - **Rename** — both active and ended states.
  - **Pin** / **Unpin** — active state only; label toggles on current pinned state.
- Existing **End session** (active) and **Resume** (ended) items are unchanged.

### Footer rail (in `Sidebar.vue`)

- **Expanded desktop:** icon + text-label rows (Combined profile / Theme / Settings /
  Sign out) for discoverability.
- **Collapsed desktop:** icon-only with tooltips (current behavior).
- Mobile drawer footer follows the expanded (labeled) treatment.

### `SidebarMobileTopStrip.vue`

No structural change. Visual token alignment only if needed for consistency.

## Backend (Tier 2) — contract-first

Follows `project_contracts_codegen` discipline: edit the OpenAPI YAML first, regenerate
Pydantic, never hand-edit `backend/contracts/`.

1. **`docs/api/openapi.yaml`**
   - Add `pinned: boolean` (default `false`) to `SessionListItem`, `SessionResponse`,
     and `SessionDetail`.
   - Add `PATCH /sessions/{id}` accepting `{ topic?: string, pinned?: boolean }`,
     returning `SessionResponse`. At least one field required; topic length validated to
     match `SessionCreateRequest` constraints.
2. **`python backend/scripts/gen_contracts.py`** — regenerate contracts; CI drift gate
   must stay green.
3. **`backend/db/models.py`** — add `pinned` column (Boolean, not null, default false).
   New Alembic migration against the Supabase-managed Postgres.
4. **`backend/routes/sessions.py`**
   - New `PATCH /sessions/{id}` handler: owner-scoped (404 on mismatch, consistent with
     existing handlers), partial update, idempotent. `pinned: true` on an ended session is
     rejected with 400 and a clear error code; rename is allowed regardless of state.
   - Thread `pinned` through `_to_response` and the `list_sessions` projection.
5. **Frontend wiring**
   - `frontend/src/services/sessionsApi.js`: `renameSession(id, topic)`,
     `setPinned(id, pinned)`.
   - `frontend/src/stores/session.js`: `renameSession` and `setPinned` actions with
     optimistic update + rollback on error; update the matching row in `sessions` and
     `currentSession` when applicable.

## Constraints Honored

- **WCAG AA:** reuse existing `--color-accent-strong` / `--color-accent-text` tokens
  (merged #49). No new white-on-coral. New text/controls meet AA contrast in both themes;
  verified live in Chrome before completion.
- **Keyboard / focus:** drawer focus trap, Escape-to-close, aria roles, and focus-visible
  rings preserved. Rename input adds its own focus management and Escape-to-cancel without
  breaking the drawer trap.
- **Stable test IDs:** existing `data-testid` attributes (rows, menu triggers, sections,
  collapse/drawer toggles) are a stable contract and are not renamed. New `data-testid`
  only for genuinely new elements: search input, rename input, pin/unpin menu item,
  pinned section, footer label rows.

## Testing

- **`frontend/src/__tests__/useSessionGroups.test.js` (new):** sort/group/filter logic,
  pin precedence, date-bucket boundaries (using injected `now`), search suppression of
  grouping, untitled-session matching.
- **`frontend/src/__tests__/sidebar.test.js` (extend):** search filtering renders flat
  list + match count; rename commit and cancel; pin toggles reorder into the pinned group;
  footer renders labeled rows when expanded, icon-only when collapsed.
- **`frontend/src/__tests__/sidebarA11y.test.js` (extend):** rename-mode focus management
  and aria intact; drawer focus trap unaffected by the new search input and rename input.
- **Backend (`backend/tests/`):** `PATCH /sessions/{id}` owner-scoping (404 cross-user),
  partial update (topic-only, pinned-only, both), reject pin on ended session, `pinned`
  present in list and detail responses. Contract-drift CI green.

## Out of Scope

- Drag-to-reorder sessions.
- Server-side search / pagination (data scale does not warrant it).
- Distinctive restyle that drifts from the app's design system (explicitly chose "evolve
  current style").
- Any change to chat, profile, or other views beyond shared token usage.

## Risks

- **DOM restructure vs. test IDs:** "redesign layout" reshuffles the DOM; mitigated by
  treating existing test IDs as a contract and extending tests rather than rewriting.
- **Tier 2 CI surface:** migration + contract regen each have their own failure modes;
  isolated into a separate plan phase so a Tier 1 ship is never blocked by them.
- **Phase-plan deviation:** net-new scope during Phase 7/8; owner-accepted, flagged here.

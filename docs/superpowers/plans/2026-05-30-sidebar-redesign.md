# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the session sidebar into a scannable navigator with search, date grouping, pin/favorite, and inline rename, preserving the coral design language, WCAG AA accent tokens (#49), keyboard/focus behavior, and existing `data-testid` contracts.

**Architecture:** A new pure composable `useSessionGroups.js` owns all list logic (filter, pin precedence, date bucketing); `Sidebar.vue` becomes a thin renderer. Tier 1 is frontend-only (search, date grouping, footer/collapsed rework) and ships independently. Tier 2 adds backend-backed pin + rename: OpenAPI YAML -> codegen -> Alembic migration -> route -> store wiring -> row UI.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vitest + @vue/test-utils, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic (codegen from OpenAPI), Supabase Postgres.

**Source of truth:** `docs/superpowers/specs/2026-05-30-sidebar-redesign-design.md`.

**Branch:** `feat/sidebar-redesign` (already created off `dev`).

**Contract discipline:** Never hand-edit `backend/contracts/`. Edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py`. CI fails on drift.

---

## File Map

**Tier 1 (frontend-only):**
- Create: `frontend/src/composables/useSessionGroups.js` — filter/pin/date-group logic (pure).
- Create: `frontend/src/__tests__/useSessionGroups.test.js` — unit tests for the composable.
- Modify: `frontend/src/components/sidebar/Sidebar.vue` — search input, grouped rendering, footer rows.
- Modify: `frontend/src/__tests__/sidebar.test.js` — search + footer tests.

**Tier 2 (backend-backed):**
- Modify: `docs/api/openapi.yaml` — `pinned` field on 3 schemas; `SessionUpdateRequest`; `PATCH /api/sessions/{session_id}`.
- Regenerate: `backend/contracts/` via `backend/scripts/gen_contracts.py`.
- Modify: `backend/db/models.py` — `pinned` column on `Session`.
- Create: `backend/db/alembic/versions/0004_sessions_pinned.py` — migration.
- Modify: `backend/routes/sessions.py` — PATCH handler; thread `pinned` through responses.
- Modify: `backend/tests/test_sessions_route.py` — PATCH tests.
- Modify: `frontend/src/services/sessionsApi.js` — `renameSession`, `setPinned`.
- Modify: `frontend/src/services/apiClient.js` — `apiPatch` helper (if absent).
- Modify: `frontend/src/stores/session.js` — `renameSession`, `setPinned` actions (optimistic + rollback).
- Modify: `frontend/src/components/sidebar/SidebarRowMenu.vue` — Rename + Pin/Unpin items.
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue` — inline rename mode + pin indicator.
- Modify: `frontend/src/__tests__/sidebarA11y.test.js` — rename-mode focus/aria.

---

# TIER 1 — Frontend-only

## Task 1: `useSessionGroups` composable

**Files:**
- Create: `frontend/src/composables/useSessionGroups.js`
- Test: `frontend/src/__tests__/useSessionGroups.test.js`

Contract: `useSessionGroups(sessionsRef, searchRef, nowRef)` returns reactive computeds.
`now` is injected (a ref or number) so date-bucket tests are deterministic.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/__tests__/useSessionGroups.test.js
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSessionGroups } from '@/composables/useSessionGroups.js'

// Fixed reference clock: 2026-05-30T12:00:00Z
const NOW = new Date('2026-05-30T12:00:00Z').getTime()
const iso = (d) => new Date(d).toISOString()

function sess(over = {}) {
  return {
    id: over.id || 'x',
    topic: over.topic ?? 'Topic',
    created_at: over.created_at ?? iso('2026-05-30T09:00:00Z'),
    ended_at: over.ended_at ?? null,
    pinned: over.pinned ?? false,
  }
}

describe('useSessionGroups', () => {
  it('buckets active sessions by created_at: today / week / older', () => {
    const sessions = ref([
      sess({ id: 'today', created_at: iso('2026-05-30T08:00:00Z') }),
      sess({ id: 'week', created_at: iso('2026-05-27T08:00:00Z') }),
      sess({ id: 'older', created_at: iso('2026-05-01T08:00:00Z') }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['today'])
    expect(byKey.week).toEqual(['week'])
    expect(byKey.older).toEqual(['older'])
  })

  it('omits empty buckets', () => {
    const sessions = ref([sess({ id: 'today', created_at: iso('2026-05-30T08:00:00Z') })])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    expect(activeGroups.value.map((g) => g.key)).toEqual(['today'])
  })

  it('floats pinned active sessions into pinnedActive, out of date groups', () => {
    const sessions = ref([
      sess({ id: 'p', pinned: true, created_at: iso('2026-05-01T08:00:00Z') }),
      sess({ id: 'today', created_at: iso('2026-05-30T08:00:00Z') }),
    ])
    const { pinnedActive, activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    expect(pinnedActive.value.map((r) => r.id)).toEqual(['p'])
    const allGrouped = activeGroups.value.flatMap((g) => g.rows.map((r) => r.id))
    expect(allGrouped).not.toContain('p')
  })

  it('keeps ended sessions separate and never pins them', () => {
    const sessions = ref([
      sess({ id: 'e', ended_at: iso('2026-05-29T08:00:00Z'), pinned: true }),
      sess({ id: 'a', created_at: iso('2026-05-30T08:00:00Z') }),
    ])
    const { endedRows, pinnedActive } = useSessionGroups(sessions, ref(''), ref(NOW))
    expect(endedRows.value.map((r) => r.id)).toEqual(['e'])
    expect(pinnedActive.value).toEqual([])
  })

  it('search produces a flat case-insensitive filtered list and suppresses grouping', () => {
    const sessions = ref([
      sess({ id: 'a', topic: 'Photosynthesis' }),
      sess({ id: 'b', topic: 'Big-O notation', ended_at: iso('2026-05-29T08:00:00Z') }),
    ])
    const search = ref('big')
    const { searching, filteredFlat, matchCount, activeGroups, pinnedActive } =
      useSessionGroups(sessions, search, ref(NOW))
    expect(searching.value).toBe(true)
    expect(filteredFlat.value.map((r) => r.id)).toEqual(['b'])
    expect(matchCount.value).toBe(1)
    expect(activeGroups.value).toEqual([])
    expect(pinnedActive.value).toEqual([])
  })

  it('untitled sessions match the literal "untitled"', () => {
    const sessions = ref([sess({ id: 'u', topic: '' })])
    const { filteredFlat } = useSessionGroups(sessions, ref('untitled'), ref(NOW))
    expect(filteredFlat.value.map((r) => r.id)).toEqual(['u'])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run useSessionGroups`
Expected: FAIL — cannot resolve `@/composables/useSessionGroups.js`.

- [ ] **Step 3: Implement the composable**

```js
// frontend/src/composables/useSessionGroups.js
import { computed, unref } from 'vue'

const DAY_MS = 86_400_000

function startOfUtcDay(ms) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function bucketKey(createdAtIso, nowMs) {
  const t = new Date(createdAtIso).getTime()
  const todayStart = startOfUtcDay(nowMs)
  if (t >= todayStart) return 'today'
  if (t >= todayStart - 6 * DAY_MS) return 'week'
  return 'older'
}

const GROUP_LABELS = { today: 'Today', week: 'This week', older: 'Older' }
const GROUP_ORDER = ['today', 'week', 'older']

function matchTopic(session, q) {
  const topic = (session.topic || 'untitled').toLowerCase()
  return topic.includes(q)
}

export function useSessionGroups(sessions, searchQuery, now) {
  const rows = computed(() => unref(sessions) || [])
  const query = computed(() => (unref(searchQuery) || '').trim().toLowerCase())
  const nowMs = computed(() => unref(now) ?? Date.now())

  const searching = computed(() => query.value.length > 0)

  const filteredFlat = computed(() =>
    searching.value ? rows.value.filter((s) => matchTopic(s, query.value)) : [],
  )
  const matchCount = computed(() => filteredFlat.value.length)

  const active = computed(() => rows.value.filter((s) => !s.ended_at))

  const pinnedActive = computed(() =>
    searching.value ? [] : active.value.filter((s) => s.pinned),
  )

  const activeGroups = computed(() => {
    if (searching.value) return []
    const unpinned = active.value.filter((s) => !s.pinned)
    const byKey = { today: [], week: [], older: [] }
    for (const s of unpinned) byKey[bucketKey(s.created_at, nowMs.value)].push(s)
    return GROUP_ORDER.filter((k) => byKey[k].length).map((k) => ({
      key: k,
      label: GROUP_LABELS[k],
      rows: byKey[k],
    }))
  })

  const endedRows = computed(() =>
    searching.value ? [] : rows.value.filter((s) => Boolean(s.ended_at)),
  )

  return { searching, filteredFlat, matchCount, pinnedActive, activeGroups, endedRows }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd frontend && npm run test:unit -- --run useSessionGroups`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useSessionGroups.js frontend/src/__tests__/useSessionGroups.test.js
git commit -m "feat(sidebar): add useSessionGroups composable for filter/pin/date-group logic"
```

---

## Task 2: Search input + flat filtered rendering in `Sidebar.vue`

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing test** (append inside the first `describe` block in `sidebar.test.js`)

```js
  it('filters sessions via the search input and shows a match count', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Photosynthesis', created_at: new Date().toISOString(), ended_at: null },
      { id: 'a2', topic: 'Big-O notation', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('photo')
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a2"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-search-count"]').text()).toContain('1')
  })

  it('shows a no-match hint when search matches nothing', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Photosynthesis', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('zzz')
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-search-empty"]').exists()).toBe(true)
  })
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: FAIL — `[data-testid="sidebar-search"]` not found.

- [ ] **Step 3: Implement — wire the composable + search input + flat list**

In `<script setup>` of `Sidebar.vue`, add imports and state, and replace the `activeSessions` / `endedSessions` / `showEmptyHint` computeds with composable-driven ones:

```js
import { useSessionGroups } from '@/composables/useSessionGroups.js'

const searchQuery = ref('')
const { searching, filteredFlat, matchCount, pinnedActive, activeGroups, endedRows } =
  useSessionGroups(sessions, searchQuery, ref(null)) // null now => Date.now() at runtime

const showSkeleton = computed(() => loading.value && !sessions.value.length)
const showEmptyHint = computed(
  () => !loading.value && !searching.value && !sessions.value.length,
)
```

Remove the now-unused `activeSessions` and `endedSessions` computeds (Task 3 re-adds grouped rendering; the Ended `watch` below must switch to `endedRows`). Update the auto-collapse watch source:

```js
watch(
  endedRows,
  (rows) => { endedOpen.value = rows.length <= 5 },
  { immediate: true },
)
```

In `<template>`, add the search input inside `.sb-cta` (or a new `.sb-search` block) directly under the New session button, rendered only when expanded:

```html
    <div v-if="isExpanded" class="sb-search">
      <i class="pi pi-search" aria-hidden="true" />
      <input
        v-model="searchQuery"
        type="search"
        class="sb-search-input"
        placeholder="Search sessions"
        aria-label="Search sessions"
        data-testid="sidebar-search"
      />
    </div>
```

Replace the `isExpanded` branch of `<nav>` so that when `searching`, it renders a flat list; otherwise it renders the existing sections (Task 3 finalizes the section markup):

```html
      <template v-if="searching">
        <p class="sb-search-count label" data-testid="sidebar-search-count">
          {{ matchCount }} {{ matchCount === 1 ? 'match' : 'matches' }}
        </p>
        <ul v-if="filteredFlat.length" class="sb-session-list">
          <SidebarSessionRow
            v-for="s in filteredFlat"
            :key="s.id"
            :session="s"
            :state="s.ended_at ? 'ended' : 'active'"
          />
        </ul>
        <p v-else class="sb-empty-hint" data-testid="sidebar-search-empty">
          No sessions match "{{ searchQuery }}".
        </p>
      </template>
      <template v-else>
        <!-- existing Active + Ended sections (finalized in Task 3) -->
      </template>
```

Add styles:

```css
.sb-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0.75rem 0.5rem;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
}
.sb-search:focus-within {
  border-color: var(--color-accent);
}
.sb-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--fs-body, 0.9375rem);
  outline: none;
}
.sb-search-count {
  padding: 0.25rem 0.75rem;
  color: var(--color-text-muted);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: PASS (existing + 2 new). If the "renders Active section" test fails because Task 3 markup is not yet in the `v-else` branch, temporarily keep the original Active/Ended section markup inside the `v-else` block — Task 3 refines it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): add session search with flat filtered results and match count"
```

---

## Task 3: Date-grouped Active rendering + pinned mini-group

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing test** (append to first `describe`)

```js
  it('renders date-group headers for active sessions', async () => {
    const store = useSessionStore()
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 3 * 86400000)
    store.sessions = [
      { id: 'a1', topic: 'Today one', created_at: now.toISOString(), ended_at: null },
      { id: 'a2', topic: 'Week one', created_at: weekAgo.toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-group-today"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-group-week"]').exists()).toBe(true)
  })

  it('renders the pinned mini-group when a session is pinned', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'p1', topic: 'Pinned', created_at: new Date().toISOString(), ended_at: null, pinned: true },
      { id: 'a1', topic: 'Normal', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-section-pinned"] [data-testid="sidebar-row-p1"]').exists()).toBe(true)
  })
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: FAIL — group/pinned testids not found.

- [ ] **Step 3: Implement — finalize the `v-else` (non-search) branch**

Replace the placeholder `v-else` block from Task 2 with:

```html
      <template v-else>
        <section
          v-if="pinnedActive.length"
          class="sb-section sb-section--pinned"
          data-testid="sidebar-section-pinned"
        >
          <h3 class="sb-section-label label">
            <i class="pi pi-bookmark-fill" aria-hidden="true" /> Pinned
            <span class="sb-section-count">({{ pinnedActive.length }})</span>
          </h3>
          <ul class="sb-session-list">
            <SidebarSessionRow v-for="s in pinnedActive" :key="s.id" :session="s" state="active" />
          </ul>
        </section>

        <section class="sb-section sb-section--active" data-testid="sidebar-section-active">
          <SidebarSkeletonList v-if="showSkeleton" :count="3" />
          <template v-else>
            <div
              v-for="g in activeGroups"
              :key="g.key"
              class="sb-group"
              :data-testid="`sidebar-group-${g.key}`"
            >
              <h3 class="sb-section-label label">{{ g.label }}</h3>
              <ul class="sb-session-list">
                <SidebarSessionRow v-for="s in g.rows" :key="s.id" :session="s" state="active" />
              </ul>
            </div>
            <p v-if="showEmptyHint" class="sb-empty-hint" data-testid="sidebar-empty-hint">
              No sessions yet. Click + New session above.
            </p>
          </template>
        </section>

        <section
          v-if="endedRows.length"
          class="sb-section sb-section--ended"
          data-testid="sidebar-section-ended"
        >
          <button
            type="button"
            class="sb-section-toggle label"
            :aria-expanded="endedOpen"
            aria-controls="sb-ended-list"
            data-testid="sidebar-ended-toggle"
            @click="endedOpen = !endedOpen"
          >
            <span>Ended <span class="sb-section-count">({{ endedRows.length }})</span></span>
            <i :class="endedOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" aria-hidden="true" />
          </button>
          <ul v-show="endedOpen" id="sb-ended-list" class="sb-session-list">
            <SidebarSessionRow v-for="s in endedRows" :key="s.id" :session="s" state="ended" />
          </ul>
        </section>
      </template>
```

Update the collapsed-rail `v-else` block (outside `isExpanded`) to keep pinned-first ordering:

```html
      <template v-else>
        <ul v-if="sessions.length" class="sb-session-list sb-session-list--collapsed">
          <SidebarSessionRow
            v-for="s in [...pinnedActive, ...activeGroups.flatMap((g) => g.rows), ...endedRows]"
            :key="s.id"
            :session="s"
            :state="s.ended_at ? 'ended' : 'active'"
          />
        </ul>
      </template>
```

Add a small style for group spacing:

```css
.sb-group { margin-bottom: 0.5rem; }
.sb-section--pinned .sb-section-label { color: var(--color-accent-text); }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: PASS. The pre-existing "renders Active section with rows", "renders Ended section", "Ended section toggles", and "aria-current" tests must still pass (testids `sidebar-section-active`, `sidebar-section-ended`, `sidebar-ended-toggle`, `#sb-ended-list` are preserved).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): date-group active sessions and add pinned mini-group"
```

---

## Task 4: Footer rail — labeled rows when expanded

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing test** (append to first `describe`)

```js
  it('footer shows text labels when expanded', async () => {
    wrapper = mount(Sidebar)
    await flushPromises()
    const footer = wrapper.find('[data-testid="sidebar-profile"]')
    expect(footer.exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-profile"]').text()).toContain('Profile')
  })

  it('footer hides text labels when collapsed', async () => {
    localStorage.setItem('adaptlearn.sidebar.expanded', '0')
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-profile"]').text()).not.toContain('Profile')
  })
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: FAIL — footer has no "Profile" text.

- [ ] **Step 3: Implement — add labels gated on `isExpanded`**

In the `<footer class="sb-rail">`, add a `<span v-if="isExpanded">` label to each control. Example for the profile link (apply the same pattern to theme, settings, sign out):

```html
      <RouterLink
        to="/profile"
        class="sb-icon"
        :class="{ 'sb-icon--row': isExpanded }"
        aria-label="Combined profile"
        title="Combined profile"
        data-testid="sidebar-profile"
        @click="closeDrawer"
      >
        <i class="pi pi-user" />
        <span v-if="isExpanded" class="sb-icon-label">Profile</span>
      </RouterLink>
```

Labels: Profile / Theme / Settings / Sign out. For the theme toggle the label may read `{{ isDark ? 'Light mode' : 'Dark mode' }}`.

Update `.sb-rail` styles so expanded mode is a vertical list of full-width labeled rows; collapsed stays the centered icon row:

```css
.sb-rail {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.125rem;
  padding: 0.5rem;
  border-top: 1px solid var(--color-border);
}
.sb-rail--column { /* collapsed: keep centered icon stack */
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.25rem;
}
.sb-icon--row {
  width: 100%;
  justify-content: flex-start;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
}
.sb-icon-label {
  font-family: var(--font-sans);
  font-size: 0.875rem;
}
```

(`.sb-rail--column` is already bound via `:class="{ 'sb-rail--column': !isExpanded }"` — keep that binding.)

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): show labeled footer rows when expanded"
```

---

## Task 5: Tier 1 verification (lint + full suite + live Chrome)

**Files:** none (verification only).

- [ ] **Step 1: Lint + format**

Run: `cd frontend && npm run lint`
Expected: clean (no errors).

- [ ] **Step 2: Full unit suite**

Run: `cd frontend && npm run test:unit -- --run`
Expected: all pass (was 321 before; new tests added).

- [ ] **Step 3: Live check in Chrome**

Start dev server if needed (`npm run dev`), open `http://localhost:5173/` at >=1280px width. Verify: search filters live; date-group headers render; footer shows labels expanded / icons collapsed; collapse toggle still works; WCAG contrast holds in both themes (no white-on-bright-coral). Capture findings; fix regressions before proceeding.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "fix(sidebar): Tier 1 live-check adjustments"
```

---

# TIER 2 — Backend-backed pin + rename

## Task 6: OpenAPI — `pinned` field, `SessionUpdateRequest`, PATCH path

**Files:**
- Modify: `docs/api/openapi.yaml`
- Regenerate: `backend/contracts/`

- [ ] **Step 1: Add `pinned` to the three session schemas**

In `SessionResponse.properties`, `SessionListItem.properties`, and `SessionDetail.properties`, add:

```yaml
        pinned:            { type: boolean, default: false }
```

(Add it to `properties` only — leave it out of `required` so existing clients/tests stay valid.)

- [ ] **Step 2: Add the `SessionUpdateRequest` schema** (place near `SessionCreateRequest`)

```yaml
    SessionUpdateRequest:
      type: object
      additionalProperties: false
      minProperties: 1
      properties:
        topic:  { type: string, maxLength: 200 }
        pinned: { type: boolean }
```

- [ ] **Step 3: Add the PATCH operation under the existing `/api/sessions/{session_id}` path**

After the `get:` block at `/api/sessions/{session_id}`, add a sibling `patch:`:

```yaml
    patch:
      tags: [sessions]
      summary: Update a session's topic and/or pinned state.
      operationId: updateSession
      parameters:
        - $ref: "#/components/parameters/SessionId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SessionUpdateRequest"
      responses:
        "200":
          description: Session updated.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SessionResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "404":
          $ref: "#/components/responses/NotFound"
```

- [ ] **Step 4: Regenerate contracts**

Run: `cd backend && python scripts/gen_contracts.py`
Expected: regenerates `backend/contracts/`; `SessionUpdateRequest` now importable; `pinned` present on session models.

- [ ] **Step 5: Verify zero drift**

Run: `cd backend && git status --porcelain backend/contracts docs/api/openapi.yaml`
Expected: only intended files changed. Confirm `python scripts/gen_contracts.py` run twice produces no further diff.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts
git commit -m "feat(contracts): add session pinned field and PATCH /sessions/{id}"
```

---

## Task 7: `pinned` column + Alembic migration

**Files:**
- Modify: `backend/db/models.py`
- Create: `backend/db/alembic/versions/0004_sessions_pinned.py`

- [ ] **Step 1: Add the column to the `Session` model**

In `backend/db/models.py`, add `Boolean` to the `sqlalchemy` import line, then add to `class Session`:

```python
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
```

- [ ] **Step 2: Write the migration**

```python
# backend/db/alembic/versions/0004_sessions_pinned.py
"""sessions: add pinned flag for sidebar favorites

Revision ID: 0004_sessions_pinned
Revises: 0003_msg_status_cancelled_at
Create Date: 2026-05-30

Adds a boolean `pinned` column to sessions (NOT NULL DEFAULT false).
Targets Postgres/Supabase.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_sessions_pinned"
down_revision: Union[str, None] = "0003_msg_status_cancelled_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("sessions", "pinned")
```

- [ ] **Step 3: Verify migration imports and revision length**

Run: `cd backend && python -c "import db.alembic.versions.0004_sessions_pinned" 2>NUL || python -c "import importlib.util,glob; f=glob.glob('db/alembic/versions/0004_sessions_pinned.py')[0]; importlib.util.spec_from_file_location('m', f)"`
Expected: no error. Confirm `0004_sessions_pinned` is <= 32 chars (it is: 20).

(Applying the migration to Supabase happens at deploy/runtime via `alembic upgrade head`; the test DB is created from models, so tests do not require the migration to run.)

- [ ] **Step 4: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0004_sessions_pinned.py
git commit -m "feat(db): add sessions.pinned column and migration 0004"
```

---

## Task 8: PATCH route + thread `pinned` through responses

**Files:**
- Modify: `backend/routes/sessions.py`
- Test: `backend/tests/test_sessions_route.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_sessions_route.py`)

```python
def _make_session(db_session, sid, pinned=False, ended=False):
    s = SessionModel(
        id=sid,
        user_id=USER_ID,
        topic="orig",
        topic_profile_json=TopicProfile().model_dump_json(),
        pinned=pinned,
        ended_at=datetime.now(timezone.utc) if ended else None,
    )
    db_session.add(s)
    db_session.commit()
    return s


def test_patch_renames_session(client, db_session, seeded_user):
    _make_session(db_session, "s_rename")
    r = client.patch("/api/sessions/s_rename", json={"topic": "new name"})
    assert r.status_code == 200, r.text
    assert r.json()["topic"] == "new name"


def test_patch_pins_active_session(client, db_session, seeded_user):
    _make_session(db_session, "s_pin")
    r = client.patch("/api/sessions/s_pin", json={"pinned": True})
    assert r.status_code == 200, r.text
    assert r.json()["pinned"] is True


def test_patch_pin_on_ended_session_400(client, db_session, seeded_user):
    _make_session(db_session, "s_ended", ended=True)
    r = client.patch("/api/sessions/s_ended", json={"pinned": True})
    assert r.status_code == 400


def test_patch_rename_allowed_on_ended_session(client, db_session, seeded_user):
    _make_session(db_session, "s_ended2", ended=True)
    r = client.patch("/api/sessions/s_ended2", json={"topic": "renamed ended"})
    assert r.status_code == 200, r.text
    assert r.json()["topic"] == "renamed ended"


def test_patch_404_for_other_user(client, db_session, seeded_user):
    other = SessionModel(
        id="s_other", user_id="someone_else", topic="x",
        topic_profile_json=TopicProfile().model_dump_json(),
    )
    db_session.add(other)
    db_session.commit()
    r = client.patch("/api/sessions/s_other", json={"topic": "hijack"})
    assert r.status_code == 404


def test_list_and_detail_include_pinned(client, db_session, seeded_user):
    _make_session(db_session, "s_list", pinned=True)
    assert client.get("/api/sessions").json()[0]["pinned"] is True
    assert client.get("/api/sessions/s_list").json()["pinned"] is True
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd backend && pytest tests/test_sessions_route.py -k patch -v`
Expected: FAIL — PATCH route 405/Not Found; `pinned` key missing.

- [ ] **Step 3: Implement — thread `pinned` and add the PATCH handler**

In `backend/routes/sessions.py`:

Add `SessionUpdateRequest` to the `from contracts import (...)` block.

In `_to_response`, add `pinned=row.pinned,` to the `SessionResponse(...)` kwargs.

In `list_sessions`, add `pinned=r.pinned,` to each `SessionListItem(...)`.

In `get_session`, add `pinned=row.pinned,` to the `SessionDetail(...)` kwargs.

Add the handler (after `reopen_session`):

```python
@router.patch("/sessions/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    req: SessionUpdateRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    if req.pinned is True and row.ended_at is not None:
        raise HTTPException(status_code=400, detail="cannot pin an ended session")
    if req.topic is not None:
        row.topic = req.topic
    if req.pinned is not None:
        row.pinned = req.pinned
    db.commit()
    db.refresh(row)
    return _to_response(db, row)
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd backend && pytest tests/test_sessions_route.py -v`
Expected: all pass (existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_sessions_route.py
git commit -m "feat(sessions): PATCH /sessions/{id} for rename + pin; expose pinned in responses"
```

---

## Task 9: Frontend API client + store actions

**Files:**
- Modify: `frontend/src/services/apiClient.js` (add `apiPatch` if missing)
- Modify: `frontend/src/services/sessionsApi.js`
- Modify: `frontend/src/stores/session.js`
- Test: `frontend/src/__tests__/sidebar.test.js` (store-action behavior)

- [ ] **Step 1: Write the failing test** (new `describe` block in `sidebar.test.js`)

```js
describe('session store — rename + pin actions', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('renameSession optimistically updates the row and calls the API', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const api = await import('@/services/sessionsApi.js')
    vi.spyOn(api, 'renameSession').mockResolvedValue({ id: 'a1', topic: 'new', pinned: false })
    await store.renameSession('a1', 'new')
    expect(store.sessions[0].topic).toBe('new')
  })

  it('setPinned rolls back on API error', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'x', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const api = await import('@/services/sessionsApi.js')
    vi.spyOn(api, 'setPinned').mockRejectedValue(new Error('boom'))
    await store.setPinned('a1', true).catch(() => {})
    expect(store.sessions[0].pinned).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: FAIL — `renameSession` / `setPinned` not exported.

- [ ] **Step 3a: Add `apiPatch` to `apiClient.js`** (append next to the existing `apiGet`/`apiPost` exports at the bottom of the file; mirrors `apiPost` exactly with method `PATCH`).

```js
export const apiPatch = (path, body, opts = {}) => request('PATCH', path, { body, ...opts })
```

- [ ] **Step 3b: Add API functions to `sessionsApi.js`**

```js
import { apiGet, apiPost, apiPatch } from './apiClient.js'

export const renameSession = (sessionId, topic) =>
  apiPatch(`/sessions/${sessionId}`, { topic })

export const setPinned = (sessionId, pinned) =>
  apiPatch(`/sessions/${sessionId}`, { pinned })
```

- [ ] **Step 3c: Add store actions to `session.js`** (define inside the store, export in the return object)

```js
  async function renameSession(id, topic) {
    const idx = sessions.value.findIndex((s) => s.id === id)
    const prev = idx !== -1 ? sessions.value[idx].topic : null
    if (idx !== -1) sessions.value[idx].topic = topic
    if (currentSession.value?.id === id) currentSession.value.topic = topic
    try {
      return await sessionsApi.renameSession(id, topic)
    } catch (e) {
      if (idx !== -1 && prev !== null) sessions.value[idx].topic = prev
      if (currentSession.value?.id === id && prev !== null) currentSession.value.topic = prev
      _setError(e)
    }
  }

  async function setPinned(id, pinned) {
    const idx = sessions.value.findIndex((s) => s.id === id)
    const prev = idx !== -1 ? sessions.value[idx].pinned : null
    if (idx !== -1) sessions.value[idx].pinned = pinned
    try {
      return await sessionsApi.setPinned(id, pinned)
    } catch (e) {
      if (idx !== -1 && prev !== null) sessions.value[idx].pinned = prev
      _setError(e)
    }
  }
```

Add `renameSession,` and `setPinned,` to the store's returned object.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/apiClient.js frontend/src/services/sessionsApi.js frontend/src/stores/session.js frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): store actions + API client for rename and pin"
```

---

## Task 10: Row menu — Rename + Pin/Unpin items

**Files:**
- Modify: `frontend/src/components/sidebar/SidebarRowMenu.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing test** (append to "row interactions" describe)

```js
  it('active row menu offers Rename and Pin', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-rename"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-menu-pin"]').exists()).toBe(true)
  })

  it('Pin menu item calls store.setPinned(true)', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const pinSpy = vi.spyOn(store, 'setPinned').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-pin"]').trigger('click')
    expect(pinSpy).toHaveBeenCalledWith('a1', true)
  })
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: FAIL — rename/pin menu items not found.

- [ ] **Step 3: Implement**

In `SidebarRowMenu.vue`: add `pinned: { type: Boolean, default: false }` to props; add `'rename'`, `'pin'`, `'unpin'` to `defineEmits`; extend `onAction` to handle these kinds (emit then `close()` + refocus trigger). Add menu items before End/Resume:

```html
      <button
        type="button" role="menuitem" class="sb-row-menu-item"
        data-testid="sidebar-row-menu-rename" :disabled="busy"
        @click="onAction('rename')"
      >
        <i class="pi pi-pencil" aria-hidden="true" /><span>Rename</span>
      </button>
      <button
        v-if="state === 'active'"
        type="button" role="menuitem" class="sb-row-menu-item"
        data-testid="sidebar-row-menu-pin" :disabled="busy"
        @click="onAction(pinned ? 'unpin' : 'pin')"
      >
        <i :class="pinned ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'" aria-hidden="true" />
        <span>{{ pinned ? 'Unpin' : 'Pin' }}</span>
      </button>
```

Extend `onAction`:

```js
function onAction(kind) {
  if (props.busy) return
  if (kind === 'end') emit('end')
  else if (kind === 'resume') emit('resume')
  else if (kind === 'rename') emit('rename')
  else if (kind === 'pin') emit('pin')
  else if (kind === 'unpin') emit('unpin')
  close()
  triggerEl.value?.focus()
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/SidebarRowMenu.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): add Rename and Pin/Unpin to row menu"
```

---

## Task 11: Inline rename + pin indicator in `SidebarSessionRow.vue`

**Files:**
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing test** (append to "row interactions" describe)

```js
  it('Rename enters inline edit and commits on Enter via store.renameSession', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    expect(input.exists()).toBe(true)
    await input.setValue('New name')
    await input.trigger('keydown.enter')
    expect(renameSpy).toHaveBeenCalledWith('a1', 'New name')
  })

  it('Rename cancels on Escape without calling the store', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('Discard me')
    await input.trigger('keydown.esc')
    expect(renameSpy).not.toHaveBeenCalled()
    expect(wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: FAIL — rename input not found / handlers absent.

- [ ] **Step 3: Implement**

In `SidebarSessionRow.vue`:

- Import `nextTick` from vue. Add `renaming = ref(false)`, `draft = ref('')`, `inputEl = ref(null)`.
- Add handlers:

```js
async function startRename() {
  draft.value = props.session.topic || ''
  renaming.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}
function cancelRename() { renaming.value = false }
async function commitRename() {
  const next = draft.value.trim()
  renaming.value = false
  if (!next || next === (props.session.topic || '')) return
  try { await store.renameSession(props.session.id, next) } catch { /* store.error populated */ }
}
function onPin() { store.setPinned(props.session.id, true).catch(() => {}) }
function onUnpin() { store.setPinned(props.session.id, false).catch(() => {}) }
```

- Wire the menu events: `@rename="startRename"`, `@pin="onPin"`, `@unpin="onUnpin"` and pass `:pinned="session.pinned"` to `<SidebarRowMenu>`.
- In the template, when `renaming`, replace `.sb-row-body` topic with an input; otherwise render the topic. Add a pin glyph before the topic when `session.pinned`:

```html
      <span v-if="!isCollapsed" class="sb-row-body">
        <input
          v-if="renaming"
          ref="inputEl"
          v-model="draft"
          type="text"
          class="sb-row-rename-input"
          aria-label="Rename session"
          data-testid="sidebar-row-rename-input"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
          @click.stop
        />
        <span v-else class="sb-row-topic">
          <i v-if="session.pinned" class="pi pi-bookmark-fill sb-row-pin" aria-hidden="true" />
          {{ session.topic || 'Untitled' }}
        </span>
        <span v-if="whenLabel && !renaming" class="sb-row-meta">{{ whenLabel }}</span>
      </span>
```

Add styles:

```css
.sb-row-rename-input {
  width: 100%;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.125rem 0.375rem;
}
.sb-row-pin {
  font-size: 0.75rem;
  color: var(--color-accent-text);
  margin-right: 0.25rem;
}
```

Note: clicking the input must not trigger `openSession` — `@click.stop` on the input handles this. The rename button lives in `SidebarRowMenu`, which already stops propagation.

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd frontend && npm run test:unit -- --run sidebar.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/SidebarSessionRow.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): inline rename and pin indicator on session rows"
```

---

## Task 12: A11y test extension + full verification + live Chrome

**Files:**
- Modify: `frontend/src/__tests__/sidebarA11y.test.js`

- [ ] **Step 1: Add a focus-management test**

```js
  it('rename input receives focus and Escape returns to a stable state', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    await flushPromises()
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    expect(document.activeElement).toBe(input.element)
    await input.trigger('keydown.esc')
    expect(wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]').exists()).toBe(false)
    wrapper.unmount()
  })
```

(Match the existing import style at the top of `sidebarA11y.test.js`; reuse its `setViewport`/mock setup.)

- [ ] **Step 2: Run a11y suite, verify pass**

Run: `cd frontend && npm run test:unit -- --run sidebarA11y`
Expected: PASS.

- [ ] **Step 3: Full verification — frontend + backend + lint**

Run:
```bash
cd frontend && npm run lint && npm run test:unit -- --run
cd ../backend && ruff check . && pytest -q
```
Expected: all green; backend contract-drift check clean.

- [ ] **Step 4: Live Chrome check**

With both servers up, at `http://localhost:5173/`: pin a session (it floats into the Pinned group), unpin it, rename a session (Enter commits, Escape cancels), rename an ended session, confirm pin is not offered on ended rows, search across active+ended. Verify WCAG contrast in light + dark for the new search input, pin glyph, rename input, and footer labels. Fix any regression.

- [ ] **Step 5: Commit (if fixes needed) + update project memory**

```bash
git add -A && git commit -m "test(sidebar): rename-mode a11y coverage; Tier 2 live-check fixes"
```

Update `MEMORY.md` / `project_chat_redesign_execution_state`-style note if the project tracks redesign progress.

---

## Self-Review Notes (author checklist — already applied)

- **Spec coverage:** search (T2), date grouping (T3), pinned mini-group (T3), pin backend (T6-T9), rename backend + UI (T6-T11), footer rework (T4), collapsed-rail pinned-first (T3), constraints/tests (T1, T5, T12). All spec sections map to a task.
- **Type consistency:** `useSessionGroups(sessions, searchQuery, now)` signature and outputs (`searching`, `filteredFlat`, `matchCount`, `pinnedActive`, `activeGroups`, `endedRows`) are identical across T1-T3. Store actions `renameSession(id, topic)` / `setPinned(id, pinned)` consistent across T9-T11. API `renameSession`/`setPinned` consistent T9-T11. Contract `SessionUpdateRequest{topic?,pinned?}` consistent T6/T8.
- **Test IDs preserved:** `sidebar-section-active`, `sidebar-section-ended`, `sidebar-ended-toggle`, `#sb-ended-list`, `sidebar-row-*`, `sidebar-row-menu-*`, `sidebar-empty-hint`, footer testids all retained; new IDs only for new elements.
- **Placeholder scan:** no TBD/TODO; every code step shows code; every command shows expected output.
- **apiClient verified:** internal helper is `request(method, path, {body, params, silent})`; `apiPatch` in T9 matches the real `apiPost` signature. No open assumptions remain.

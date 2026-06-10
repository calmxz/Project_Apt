# WS2 — Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the session sidebar with richer rows (topic + description + last-active), an explicit Active | Ended segmented toggle replacing the auto-collapse-past-5 behavior, and last-activity-based bucketing/sorting.

**Architecture:** Three layers change. (1) The `useSessionGroups` composable flips its bucket/sort key from `created_at` to `last_activity_at` (with `created_at` fallback) and gains a bucketed `endedGroups`. (2) `SidebarSessionRow.vue` reuses the WS1 `sessionCard` util (`cardDescription` + `cardMeta`) for its description and meta lines instead of computing its own `whenLabel`. (3) `Sidebar.vue` replaces the collapsible Ended section with a two-segment Active | Ended tab control (reusing the `SessionsLibraryView` filter pattern). No backend change — WS0 already enriched the shared `SessionListItem` (`message_count`, `last_activity_at`, `last_message_preview`, `progress`).

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vitest + @vue/test-utils, scoped CSS with design tokens from `base.css`. PrimeVue icons only (`pi pi-*`).

**Source of truth:** `docs/superpowers/specs/2026-06-08-sessions-ux-and-performance-design.md` — WS2 section (lines 183-207).

---

## Decisions (resolved from spec + review; not user-blocking)

- **Row meta line:** reuse `cardMeta(session)` whole (`"N messages · last active X"`) — the spec's stated goal is consistency across home/library/sidebar. (If live smoke shows rows too tall in the 16rem column, switching to bare "last active X" is a one-line change.)
- **Search scope:** unchanged — search overrides the toggle and shows a flat, case-insensitive list across all sessions.
- **Ended tab:** buckets by `last_activity_at` (Today / This week / Older), same as Active.
- **Time semantics:** rows show and sort by `last_activity_at` falling back to `created_at`; buckets computed from the same. A recently-touched old session moves to Today. Sort within each bucket is most-recently-active first.
- **Collapsed icon rail:** unchanged — dot-only markers, no description/meta body (row body is already `v-if="!isCollapsed"`).
- **Pinned mini-group:** stays at the top of the Active view only (never under Ended, never while searching).

## Behavior that must survive untouched (regression guard)

Pins (set/unset), inline rename, end/resume actions, mobile drawer + focus trap, `aria-current="page"` on the current row, the collapsed icon rail, search + no-match hint, and the `sidebarA11y` suite. Task 5 runs the full suite to confirm.

## File structure

- Modify: `frontend/src/composables/useSessionGroups.js` — bucket/sort by activity, add `endedGroups`.
- Modify: `frontend/src/__tests__/useSessionGroups.test.js` — add last-activity + sort + endedGroups tests.
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue` — description + meta via `sessionCard` util; row CSS.
- Modify: `frontend/src/components/sidebar/Sidebar.vue` — Active | Ended segmented toggle; remove auto-collapse; toggle CSS.
- Modify: `frontend/src/__tests__/sidebar.test.js` — flip the two Ended-section tests; add toggle + row-content tests.

---

### Task 1: Composable — bucket and sort by `last_activity_at`, add `endedGroups`

**Files:**
- Modify: `frontend/src/composables/useSessionGroups.js`
- Test: `frontend/src/__tests__/useSessionGroups.test.js`

- [ ] **Step 1: Write the failing tests**

First, update the `sess()` factory in `frontend/src/__tests__/useSessionGroups.test.js` (lines 10-18). The current factory hard-codes its fields and **silently drops any `last_activity_at` override**, which would make the tests below exercise the `created_at` fallback instead of what they claim to test. Change it to thread `last_activity_at`:

```js
function sess(over = {}) {
  return {
    id: over.id || 'x',
    topic: over.topic ?? 'Topic',
    created_at: over.created_at ?? iso('2026-05-30T09:00:00Z'),
    last_activity_at: over.last_activity_at ?? null,
    ended_at: over.ended_at ?? null,
    pinned: over.pinned ?? false,
  }
}
```

Then append these tests inside the existing `describe('useSessionGroups', ...)` block:

```js
  it('buckets by last_activity_at, not created_at: an old session touched today is "today"', () => {
    const sessions = ref([
      sess({
        id: 'touched',
        created_at: iso('2026-05-01T08:00:00Z'), // old
        last_activity_at: iso('2026-05-30T08:00:00Z'), // today
      }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['touched'])
    expect(byKey.older).toBeUndefined()
  })

  it('falls back to created_at when last_activity_at is null', () => {
    const sessions = ref([
      sess({ id: 'noact', created_at: iso('2026-05-30T08:00:00Z'), last_activity_at: null }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['noact'])
  })

  it('sorts rows within a bucket most-recently-active first', () => {
    const sessions = ref([
      sess({ id: 'older', last_activity_at: iso('2026-05-30T06:00:00Z') }),
      sess({ id: 'newer', last_activity_at: iso('2026-05-30T11:00:00Z') }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const today = activeGroups.value.find((g) => g.key === 'today')
    expect(today.rows.map((r) => r.id)).toEqual(['newer', 'older'])
  })

  it('exposes endedGroups bucketed by last activity', () => {
    const sessions = ref([
      sess({
        id: 'e-today',
        ended_at: iso('2026-05-29T08:00:00Z'),
        last_activity_at: iso('2026-05-30T08:00:00Z'),
      }),
      sess({
        id: 'e-old',
        ended_at: iso('2026-05-02T08:00:00Z'),
        last_activity_at: iso('2026-05-01T08:00:00Z'),
      }),
    ])
    const { endedGroups, endedRows } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(endedGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['e-today'])
    expect(byKey.older).toEqual(['e-old'])
    // flat endedRows retained for the count badge + collapsed rail, sorted by activity
    expect(endedRows.value.map((r) => r.id)).toEqual(['e-today', 'e-old'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/useSessionGroups.test.js`
Expected: the four new tests FAIL — `endedGroups` is `undefined`; old session buckets as `older` not `today` (created_at path); within-bucket order unsorted.

- [ ] **Step 3: Rewrite the composable**

Replace the entire contents of `frontend/src/composables/useSessionGroups.js` with:

```js
// frontend/src/composables/useSessionGroups.js
import { computed, unref } from 'vue'

const DAY_MS = 86_400_000

// Dates bucket by UTC calendar day so grouping is consistent across timezones.
function startOfUtcDay(ms) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Activity timestamp drives bucketing AND sorting. Falls back to created_at
// when a session has no messages (last_activity_at is null). Returns ms, 0 if neither.
function activityMs(session) {
  const ts = session.last_activity_at || session.created_at
  return ts ? new Date(ts).getTime() : 0
}

function bucketKey(activityTs, nowMs) {
  const todayStart = startOfUtcDay(nowMs)
  if (activityTs >= todayStart) return 'today'
  if (activityTs >= todayStart - 6 * DAY_MS) return 'week'
  return 'older'
}

const GROUP_LABELS = { today: 'Today', week: 'This week', older: 'Older' }
const GROUP_ORDER = ['today', 'week', 'older']

function matchTopic(session, q) {
  const topic = (session.topic || 'untitled').toLowerCase()
  return topic.includes(q)
}

// Most-recently-active first.
function byActivityDesc(a, b) {
  return activityMs(b) - activityMs(a)
}

function groupByActivity(list, nowMs) {
  const byKey = { today: [], week: [], older: [] }
  for (const s of list) byKey[bucketKey(activityMs(s), nowMs)].push(s)
  for (const k of GROUP_ORDER) byKey[k].sort(byActivityDesc)
  return GROUP_ORDER.filter((k) => byKey[k].length).map((k) => ({
    key: k,
    label: GROUP_LABELS[k],
    rows: byKey[k],
  }))
}

export function useSessionGroups(sessions, searchQuery, now) {
  const rows = computed(() => unref(sessions) || [])
  const query = computed(() => (unref(searchQuery) || '').trim().toLowerCase())
  // When `now` is null at runtime, Date.now() is captured at setup time; buckets
  // refresh on next mount. No ticker needed at this data scale.
  const nowMs = computed(() => unref(now) ?? Date.now())

  const searching = computed(() => query.value.length > 0)

  // Search shows a flat, case-insensitive match list across all sessions, unsorted —
  // matches prior production behavior; spec scopes search to a "flat list", not sorted.
  const filteredFlat = computed(() =>
    searching.value ? rows.value.filter((s) => matchTopic(s, query.value)) : [],
  )
  const matchCount = computed(() => filteredFlat.value.length)

  const active = computed(() => rows.value.filter((s) => !s.ended_at))

  const pinnedActive = computed(() =>
    searching.value ? [] : active.value.filter((s) => s.pinned).slice().sort(byActivityDesc),
  )

  const activeGroups = computed(() => {
    if (searching.value) return []
    const unpinned = active.value.filter((s) => !s.pinned)
    return groupByActivity(unpinned, nowMs.value)
  })

  const endedAll = computed(() => rows.value.filter((s) => Boolean(s.ended_at)))

  const endedGroups = computed(() =>
    searching.value ? [] : groupByActivity(endedAll.value, nowMs.value),
  )

  // Flat ended list retained for the count badge and the collapsed icon rail.
  const endedRows = computed(() =>
    searching.value ? [] : endedAll.value.slice().sort(byActivityDesc),
  )

  return {
    searching,
    filteredFlat,
    matchCount,
    pinnedActive,
    activeGroups,
    endedGroups,
    endedRows,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/useSessionGroups.test.js`
Expected: PASS — all pre-existing tests (which seed only `created_at`, exercising the fallback path) plus the four new tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useSessionGroups.js frontend/src/__tests__/useSessionGroups.test.js
git commit -m "feat(sidebar): bucket and sort sessions by last_activity_at, add endedGroups"
```

---

### Task 2: Row — description + meta via `sessionCard` util

**Files:**
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing test**

Add this test inside the first `describe('Sidebar.vue', ...)` block in `frontend/src/__tests__/sidebar.test.js` (after the existing render tests):

```js
  it('renders a description line and a meta line in each row', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Glycolysis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
        message_count: 4,
        progress: { focus_target_gap: 'ATP yield', mastered_count: 0 },
        last_message_preview: null,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const row = wrapper.find('[data-testid="sidebar-row-a1"]')
    expect(row.find('.sb-row-desc').text()).toBe('Focus: ATP yield')
    expect(row.find('.sb-row-meta').text()).toContain('4 messages')
    expect(row.find('.sb-row-meta').text()).toContain('last active')
  })

  it('highlights the current session row', async () => {
    routeRef.params = { id: 'a1' }
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Glycolysis', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Closes clause (b) of the spec's first WS2 test bullet (current session highlighted)
    // with an automated check rather than deferring entirely to live smoke.
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').classes()).toContain('sb-row--current')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js -t "renders a description line"`
Expected: FAIL — `.sb-row-desc` does not exist; `.sb-row-meta` currently shows "started <rel>", not "4 messages".

- [ ] **Step 3: Update the row component**

In `frontend/src/components/sidebar/SidebarSessionRow.vue`:

3a. Replace the `formatRelative` import (line 4) **entirely** — after this task the row no longer uses it (cardMeta imports its own copy), and `eslint`'s `no-unused-vars` is error-level, so a leftover import fails `npm run lint`. Change:

```js
import { formatRelative } from '@/utils/formatDate.js'
```
to:
```js
import { cardDescription, cardMeta } from '@/utils/sessionCard.js'
```

3b. Replace the `whenLabel` and `tooltip` computeds (lines 29-39) with the description/meta computeds plus stable ids for screen-reader association (the row button's explicit `aria-label` otherwise overrides the new inner spans, hiding them from SR — `aria-describedby` re-exposes them):

```js
const description = computed(() => cardDescription(props.session))
const meta = computed(() => cardMeta(props.session))

const descId = computed(() => `sb-row-desc-${props.session.id}`)
const metaId = computed(() => `sb-row-meta-${props.session.id}`)
const describedBy = computed(() => {
  const ids = []
  if (description.value) ids.push(descId.value)
  ids.push(metaId.value)
  return ids.join(' ')
})

const tooltip = computed(() => {
  const d = cardDescription(props.session)
  const topic = props.session.topic || 'Untitled'
  return d ? `${topic} — ${d}` : topic
})
```

3c. In the template, add `aria-describedby` to the row open button. After the `:aria-label="..."` attribute on the `<button ... data-testid="sidebar-row-open"` element (around line 136), add:

```html
      :aria-describedby="!isCollapsed ? describedBy : undefined"
```

Then replace the single meta span (line 160):

```html
        <span v-if="whenLabel && !renaming" class="sb-row-meta">{{ whenLabel }}</span>
```
with the description + meta spans carrying the ids:
```html
        <span v-if="description && !renaming" :id="descId" class="sb-row-desc">{{ description }}</span>
        <span v-if="!renaming" :id="metaId" class="sb-row-meta">{{ meta }}</span>
```

3d. In `<style scoped>`, add a `.sb-row-desc` rule immediately before the existing `.sb-row-meta` rule (line 273), and make the current-session topic medium-bold. Insert:

```css
.sb-row-desc {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}

.sb-row--ended .sb-row-desc {
  color: var(--color-text-muted);
}

.sb-row--current .sb-row-topic {
  font-weight: 600;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js -t "renders a description line"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/SidebarSessionRow.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): rich rows reuse cardDescription + cardMeta from WS1"
```

---

### Task 3: Sidebar shell — Active | Ended segmented toggle replaces auto-collapse

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Flip the two stale tests and add the toggle test**

In `frontend/src/__tests__/sidebar.test.js`:

1a. REPLACE the test `it('renders Ended section when ended sessions exist', ...)` (the one that mounts an active + ended session and asserts `sidebar-section-ended` exists by default) with:

```js
  it('shows an Ended tab with a count when ended sessions exist', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
      { id: 'e1', topic: 'Recursion', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Default view is Active: the ended row is behind the Ended tab, not visible yet.
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(false)
    const endedTab = wrapper.find('[data-testid="sidebar-status-ended"]')
    expect(endedTab.exists()).toBe(true)
    expect(endedTab.text()).toContain('1')
  })
```

1b. REPLACE the test `it('Ended section toggles visibility', ...)` (the auto-collapse `sidebar-ended-toggle` test) with:

```js
  it('Active/Ended toggle switches which sessions are shown', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Active one', created_at: '2026-05-20T10:00:00Z', ended_at: null },
      { id: 'e1', topic: 'Ended one', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Active view by default.
    expect(wrapper.find('[data-testid="sidebar-status-active"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(false)
    // Switch to Ended.
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-status-ended"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(false)
  })

  it('keeps the pinned mini-group under the Active view only', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'p1', topic: 'Pinned', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: true },
      { id: 'e1', topic: 'Ended', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(true)
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(false)
  })
```

1c. **Flip three more existing tests** that seed an **ended-only** store and interact with the ended row in the default mount. With the toggle defaulting to Active, those rows are no longer in the DOM, so `.find(...).trigger(...)` throws / `.exists()` returns false. Each must switch to the Ended tab first. The three tests (current approximate locations):

- `it('Resume menu item calls store.reopenSession and navigates', ...)` (~lines 232-245)
- `it('Ended row does not offer End menu item', ...)` (~lines 247-257)
- `it('does not show the pin glyph on an ended (but pinned) session', ...)` (~lines 360-370)

In each, immediately after the `await flushPromises()` that follows `mount(Sidebar)` and before the first `.find('[data-session-id="e1"]...')`, insert:

```js
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
```

For the pin-glyph test, also update its stale comment ("ended section uses v-show so the row is in the DOM") — the Ended view is now `v-if`-gated, not `v-show`.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js -t "toggle"`
Expected: FAIL — `sidebar-status-active` / `sidebar-status-ended` do not exist yet.

- [ ] **Step 3: Update `Sidebar.vue` script**

3a. Replace the `endedOpen` ref (line 25) and remove the auto-collapse watch (lines 106-112).

Change line 25 from:
```js
const endedOpen = ref(true)
```
to:
```js
const statusFilter = ref('active') // 'active' | 'ended'
const STATUS_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
]
```

3b. Destructure `endedGroups` from the composable. Change lines 86-87 from:
```js
const { searching, filteredFlat, matchCount, pinnedActive, activeGroups, endedRows } =
  useSessionGroups(sessions, searchQuery, ref(null)) // null => Date.now() captured at setup time
```
to:
```js
const { searching, filteredFlat, matchCount, pinnedActive, activeGroups, endedGroups, endedRows } =
  useSessionGroups(sessions, searchQuery, ref(null)) // null => Date.now() captured at setup time
```

3c. DELETE the auto-collapse watch block (lines 106-112):
```js
// Auto-collapse Ended section when there are many ended sessions, default open
// when there are few. Per spec: collapsed if > 5, open if ≤ 5.
watch(
  () => endedRows.value.length,
  (count) => { endedOpen.value = count <= 5 },
  { immediate: true },
)
```

3d. Add an empty-state computed for the active view next to `showEmptyHint` (after line 95). Change:
```js
const showEmptyHint = computed(
  () => !loading.value && !searching.value && !sessions.value.length,
)
```
to:
```js
const showEmptyHint = computed(
  () => !loading.value && !searching.value && !sessions.value.length,
)

const showEmptyActiveHint = computed(
  () => !loading.value && !searching.value && sessions.value.length > 0 && !activeGroups.value.length && !pinnedActive.value.length,
)
```

- [ ] **Step 4: Update `Sidebar.vue` template**

4a. Add the segmented toggle between the search block (closes at line 221) and the `<nav>` (line 223). It uses `role="group"` + `aria-pressed` toggle buttons — **not** `role="tablist"`/`role="tab"`/`aria-selected`, which would promise roving tabindex, arrow-key navigation, and `tabpanel`s this control does not implement (a WCAG 4.1.2 name/role/value mismatch). The buttons are already Tab-focusable and Space/Enter-activate, so `aria-pressed` correctly announces state with zero extra JS. Insert after line 221:

```html
    <div
      v-if="isExpanded && !searching"
      class="sb-status-toggle"
      role="group"
      aria-label="Filter sessions by status"
    >
      <button
        v-for="t in STATUS_TABS"
        :key="t.key"
        type="button"
        class="sb-status-btn"
        :class="{ active: statusFilter === t.key }"
        :aria-pressed="statusFilter === t.key"
        :data-testid="`sidebar-status-${t.key}`"
        @click="statusFilter = t.key"
      >
        {{ t.label }}
        <span v-if="t.key === 'ended' && endedRows.length" class="sb-section-count">({{ endedRows.length }})</span>
      </button>
    </div>
```

4b. Replace the entire non-searching `<template v-else>` block (lines 241-296 — the `pinnedActive` section + `sb-section--active` + `sb-section--ended` collapsible) with the toggle-driven views:

```html
        <template v-else>
          <!-- ACTIVE view: pinned mini-group + activity buckets -->
          <template v-if="statusFilter === 'active'">
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
                <p v-else-if="showEmptyActiveHint" class="sb-empty-hint" data-testid="sidebar-empty-active">
                  No active sessions. Check the Ended tab.
                </p>
              </template>
            </section>
          </template>

          <!-- ENDED view: activity buckets, no pinning -->
          <section
            v-else
            class="sb-section sb-section--ended"
            data-testid="sidebar-section-ended"
          >
            <div
              v-for="g in endedGroups"
              :key="g.key"
              class="sb-group"
              :data-testid="`sidebar-ended-group-${g.key}`"
            >
              <h3 class="sb-section-label label">{{ g.label }}</h3>
              <ul class="sb-session-list">
                <SidebarSessionRow v-for="s in g.rows" :key="s.id" :session="s" state="ended" />
              </ul>
            </div>
            <p v-if="!endedGroups.length" class="sb-empty-hint" data-testid="sidebar-ended-empty">
              No ended sessions yet.
            </p>
          </section>
        </template>
```

(The collapsed icon-rail `<template v-else>` block at lines 299-309 is unchanged — it still iterates `[...pinnedActive, ...activeFlat, ...endedRows]`.)

- [ ] **Step 5: Add toggle CSS**

In `Sidebar.vue` `<style scoped>`, add before the final `.sb-group` rule (line 655):

```css
.sb-status-toggle {
  display: flex;
  gap: 0.25rem;
  margin: 0 0.75rem 0.5rem;
}

.sb-status-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.3125rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.sb-status-btn:hover {
  border-color: var(--color-accent-soft);
  color: var(--color-text);
}

.sb-status-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-status-btn.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

.sb-status-btn.active .sb-section-count {
  color: var(--color-accent-text);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js`
Expected: PASS — the flipped tests, the new toggle/pinned tests, and all unchanged tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): replace ended auto-collapse with Active | Ended toggle"
```

---

### Task 4: Visual polish — density and group-label hierarchy (concrete CSS)

**Verification method:** This task is visual; it is verified by live browser smoke (Task 6), NOT by a unit assertion. Each change below is a concrete token edit — no "make it tighter" placeholders.

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (style block)
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue` (style block)

- [ ] **Step 1: Tighten row vertical rhythm**

In `SidebarSessionRow.vue`, change `.sb-row-body` gap (line 254) from `gap: 0.125rem;` to `gap: 0.0625rem;` so topic/desc/meta read as one stacked unit, and change `.sb-row-button` padding (line 215) from `padding: 0.5rem 0.5rem 0.5rem 0.75rem;` to `padding: 0.4375rem 0.5rem 0.4375rem 0.75rem;`.

- [ ] **Step 2: Make the meta line quieter than the description**

In `SidebarSessionRow.vue`, change `.sb-row-meta` color (line 276) from `color: var(--color-text-muted);` to `color: var(--color-text-faint);` so the three lines form a clear topic → description → meta contrast ramp (status conveyed by typographic weight, not solely the dot).

- [ ] **Step 3: Separate group labels from rows; drop dead CSS**

In `Sidebar.vue`, change `.sb-group` (line 655) from `margin-bottom: 0.5rem;` to:

```css
.sb-group { margin-bottom: 0.75rem; }
.sb-group + .sb-group { margin-top: 0.25rem; }
```

Then remove the now-dead `.sb-section-toggle` CSS left over from the removed Ended-collapse button (Task 3 deleted the only element that used it): in the shared selector around lines 508-509, remove the `,\n.sb-section-toggle` so only `.sb-section-label` remains, and delete the dedicated `.sb-section-toggle`, `.sb-section-toggle:hover`, and `.sb-section-toggle:focus-visible` rules (lines ~527-540).

- [ ] **Step 4: Run the full frontend suite to confirm no regression from CSS edits**

Run (from `frontend/`): `npm run test:unit -- --run`
Expected: PASS (CSS-only edits; behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/SidebarSessionRow.vue frontend/src/components/sidebar/Sidebar.vue
git commit -m "style(sidebar): tighten row rhythm and group-label hierarchy"
```

---

### Task 5: Full regression — frontend suite + a11y + lint

**Verification method:** automated.

- [ ] **Step 1: Run the entire frontend unit suite**

Run (from `frontend/`): `npm run test:unit -- --run`
Expected: PASS, full count green (previously 407 in WS1; this plan adds tests, so the count is higher). In particular confirm `sidebarA11y.test.js` and `sidebarMobileStrip.test.js` pass — the toggle markup must not break the focus trap or mobile drawer.

- [ ] **Step 2: Lint**

Run (from `frontend/`): `npm run lint`
Expected: no errors. (Task 2 step 3a already drops the unused `formatRelative` import, so `no-unused-vars` should not fire on the row.)

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -A
git commit -m "chore(sidebar): lint fixes for WS2"
```

(Skip this commit if lint produced no changes.)

---

### Task 6: Live browser smoke (manual / Playwright)

**Verification method:** live app against real Supabase data. This task validates the visual and behavioral requirements that unit tests cannot.

- [ ] **Step 1: Start the app and sign in**

Run the frontend dev server (from `frontend/`: `npm run dev`), ensure the backend is reachable, and sign in with the magic-link flow to load the real account (6 sessions per the spec's measured data).

- [ ] **Step 2: Verify the checklist**

Confirm each, in the expanded desktop sidebar:
- Each active row shows a distinct description line (Focus / preview / mastery / fallback) and a `N messages · last active X` meta line.
- The current session is clearly highlighted (accent rail + soft background + bolder topic) and scrolls into view on navigation.
- Active | Ended toggle: default Active; clicking Ended shows only ended sessions, bucketed Today / This week / Older; clicking Active returns. Pinned mini-group appears only under Active.
- A session created days ago but used today appears under **Today** (last-activity bucketing).
- Search still produces a flat match list and the no-match hint.
- Collapse the sidebar (desktop): the icon rail shows dot-only markers, no description/meta text.
- Mobile width: the drawer opens/closes, focus trap works, the toggle is usable.
- Row density reads cleanly — if rows feel too tall, note it (the meta line can drop to bare "last active X" per the Decisions block).

- [ ] **Step 3: Record the result**

Note PASS/FAIL per item. On any FAIL, stop and report before merging.

---

## Self-review checklist (run by plan author after writing)

- **Spec coverage:** richer rows (Task 2) ✓; tighter hierarchy (Task 4) ✓; Active/Ended split (Task 3) ✓; last_activity_at bucketing + sort (Task 1) ✓; current-session highlight (Task 2 — the new "highlights the current session row" test + Task 4 CSS) ✓; the three WS2 test bullets (rows render description + last-active; toggle filters; bucketing by last activity) are covered by Tasks 1-3 ✓.
- **Intentional extensions beyond strict spec** (flagged so reviewers don't read them as requirements): the Ended view is bucketed by last activity (spec requires bucketing only for Active) for visual consistency; the Active|Ended control uses `role="group"` + `aria-pressed` (correct for a no-JS button group) rather than the spec-neutral "segmented toggle" wording; row description/meta are exposed to screen readers via `aria-describedby` since the button's `aria-label` would otherwise suppress them.
- **Regression enumeration:** **FIVE** stale `sidebar.test.js` tests are flipped in Task 3 step 1 — the two Ended-section rendering tests (1a, 1b) plus three ended-only row-interaction tests (1c: Resume, End-menu, ended-pin-glyph) that break because ended rows now sit behind the Ended tab. The `sess()` test helper is patched in Task 1 step 1 to thread `last_activity_at`. Pins/rename/drawer/a11y/collapsed-rail confirmed via Task 5.
- **Null fallback in BOTH places:** `activityMs` is used by `bucketKey` (bucket) and `byActivityDesc` (sort) — single helper, so the `created_at` fallback can't be added to one and forgotten in the other.
- **Type consistency:** `endedGroups`, `endedRows`, `pinnedActive`, `activeGroups`, `statusFilter`, `STATUS_TABS`, `showEmptyActiveHint`, testids `sidebar-status-active|ended`, `sidebar-ended-group-*` are used consistently across tasks.
- **No placeholders:** every code step shows the full edit.

## Execution handoff

Recommended: superpowers:subagent-driven-development — fresh subagent per task, two-stage review between tasks. Tasks 1-3 are TDD (red → green → commit); Task 4 is concrete CSS verified at Task 6; Tasks 5-6 are verification gates.

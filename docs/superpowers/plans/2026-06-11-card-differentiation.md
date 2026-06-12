# Sidebar vs Home Card Differentiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Differentiate the sidebar rail (structured chips, compact meta, no prose) from home/library cards (narrative story + chips + verbose meta), per `docs/superpowers/specs/2026-06-11-card-differentiation-design.md`.

**Architecture:** Pure frontend. `sessionCard.js` grows three surface-specific helpers (`cardStory`, `cardChips`, `railMeta`) while `cardDescription` is migrated off and deleted last. A new shared `SessionChips.vue` renders the chip row in two variants (`rail` for the sidebar, `card` for home/library). Consumers migrate one per task so the suite stays green at every commit.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, vitest + @vue/test-utils. All commands run from `frontend/`.

**Branch:** `feat/card-differentiation` (already created off `dev` at `7a2a17b`; spec committed).

**Ground rules for every task:** run the FULL unit suite (`npm run test:unit -- --run`) before each commit, not just the task's file (WS1 lesson: an import prune broke a different route's tests). Run `npm run lint` after frontend work — the lint script is `--fix`-flavored and CI runs it without `--fix` (WS3 lesson).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/utils/formatDate.js` | Modify | Add `formatRelativeShort` (reuses existing `STEPS` table) |
| `frontend/src/utils/sessionCard.js` | Modify | Add `cardStory` / `cardChips` / `railMeta`; later delete `cardDescription` |
| `frontend/src/components/SessionChips.vue` | Create | Shared chip row, `rail` / `card` variants, a11y-safe |
| `frontend/src/components/sidebar/SidebarSessionRow.vue` | Modify | Chips replace prose desc; `railMeta`; tooltip + aria from chips |
| `frontend/src/views/HomeView.vue` | Modify | Story line + chips row on recent cards |
| `frontend/src/views/SessionsLibraryView.vue` | Modify | Story line + chips row on library cards |
| `frontend/src/__tests__/formatDate.test.js` | Modify | `formatRelativeShort` tests |
| `frontend/src/__tests__/sessionCard.test.js` | Modify | New-API tests; old `cardDescription` tests deleted last |
| `frontend/src/__tests__/sessionChips.test.js` | Create | Component tests |
| `frontend/src/__tests__/sidebar.test.js` | Modify | Chips/meta/aria/tooltip row assertions |
| `frontend/src/__tests__/homeView.test.js` | Modify | Story-vs-chips assertions |
| `frontend/src/__tests__/sessionsLibraryView.test.js` | Modify | Story-vs-chips assertions |

---

### Task 1: `formatRelativeShort` in formatDate.js

**Files:**
- Modify: `frontend/src/utils/formatDate.js` (after the `formatRelative` export, ~line 42)
- Test: `frontend/src/__tests__/formatDate.test.js`

- [ ] **Step 1: Write the failing tests**

Add `formatRelativeShort` to the import list at the top of `frontend/src/__tests__/formatDate.test.js`, then append this describe block at the end of the file. The file already has `afterEach(() => vi.useRealTimers())`.

```javascript
describe('formatRelativeShort', () => {
  it('returns empty string for null/empty input', () => {
    expect(formatRelativeShort(null)).toBe('')
    expect(formatRelativeShort('')).toBe('')
  })

  it('returns "now" under a minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    expect(formatRelativeShort('2026-01-15T11:59:30Z')).toBe('now')
  })

  it('uses the minute bucket right at 60s', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    expect(formatRelativeShort('2026-01-15T11:59:00Z')).toBe('1m ago')
  })

  it('formats minutes, hours, days, weeks, months, years compactly', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    expect(formatRelativeShort('2026-01-15T11:55:00Z')).toBe('5m ago')
    expect(formatRelativeShort('2026-01-15T10:00:00Z')).toBe('2h ago')
    expect(formatRelativeShort('2026-01-12T12:00:00Z')).toBe('3d ago')
    expect(formatRelativeShort('2026-01-01T12:00:00Z')).toBe('2w ago')
    expect(formatRelativeShort('2025-11-15T12:00:00Z')).toBe('2mo ago')
    expect(formatRelativeShort('2024-01-15T12:00:00Z')).toBe('2y ago')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run formatDate`
Expected: FAIL — `formatRelativeShort` is not exported.

- [ ] **Step 3: Implement**

In `frontend/src/utils/formatDate.js`, directly below the `formatRelative` export:

```javascript
const SHORT_UNITS = { minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }

// Compact rail variant of formatRelative: "5m ago", "2h ago", "3d ago".
// Same STEPS thresholds; sub-minute renders as "now".
export const formatRelativeShort = (iso) => {
  if (!iso) return ''
  const absSec = Math.abs((Date.now() - new Date(iso).getTime()) / 1000)
  if (absSec < 60) return 'now'
  for (const { limit, divisor, unit } of STEPS) {
    if (absSec < limit) {
      return `${Math.round(absSec / divisor)}${SHORT_UNITS[unit]} ago`
    }
  }
  return `${Math.round(absSec / 31557600)}y ago`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run formatDate`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm run test:unit -- --run` then `npm run lint`
Expected: all green, no working-tree changes from lint.

```bash
git add frontend/src/utils/formatDate.js frontend/src/__tests__/formatDate.test.js
git commit -m "feat(fe): add formatRelativeShort compact relative-time formatter"
```

---

### Task 2: New sessionCard API — `cardStory`, `cardChips`, `railMeta`

`cardDescription` stays in place untouched until Task 7 so existing consumers keep working.

**Files:**
- Modify: `frontend/src/utils/sessionCard.js`
- Test: `frontend/src/__tests__/sessionCard.test.js`

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/sessionCard.test.js`, change the two import lines to:

```javascript
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  stripAutoPrefix,
  cardDescription,
  cardMeta,
  cardStory,
  cardChips,
  railMeta,
} from '@/utils/sessionCard.js'
```

Below the existing `active` factory add `afterEach(() => vi.useRealTimers())`, then append at the end of the file (the `active` factory's `created_at` is `'2026-06-01T00:00:00Z'`):

```javascript
describe('cardStory', () => {
  it('active: returns the trimmed preview', () => {
    const s = active({ last_message_preview: '  What is ATP?  ' })
    expect(cardStory(s)).toBe('What is ATP?')
  })

  it('active: empty string when no preview — focus and mastery do NOT leak in', () => {
    const s = active({ progress: { focus_target_gap: 'ATP yield', mastered_count: 3 } })
    expect(cardStory(s)).toBe('')
  })

  it('ended: summary with [auto] stripped; Completed fallback', () => {
    const ended = active({
      ended_at: '2026-06-02T00:00:00Z',
      last_session_summary: '[auto] Covered the Krebs cycle',
    })
    expect(cardStory(ended)).toBe('Covered the Krebs cycle')
    const bare = active({ ended_at: '2026-06-02T00:00:00Z', last_session_summary: null })
    expect(cardStory(bare)).toBe('Completed')
  })
})

describe('cardChips', () => {
  it('returns focus then mastered when both present', () => {
    const s = active({ progress: { focus_target_gap: 'ATP yield', mastered_count: 2 } })
    expect(cardChips(s)).toEqual([
      { type: 'focus', label: 'ATP yield' },
      { type: 'mastered', label: '2 mastered', count: 2 },
    ])
  })

  it('omits the mastered chip at zero and the focus chip when null', () => {
    expect(cardChips(active())).toEqual([])
    expect(
      cardChips(active({ progress: { focus_target_gap: null, mastered_count: 1 } })),
    ).toEqual([{ type: 'mastered', label: '1 mastered', count: 1 }])
  })

  it('handles null progress safely', () => {
    expect(cardChips(active({ progress: null }))).toEqual([])
  })
})

describe('railMeta', () => {
  it('compact count and short relative time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T02:00:00Z'))
    const s = active({ message_count: 12, last_activity_at: '2026-06-01T00:00:00Z' })
    expect(railMeta(s)).toBe('12 msgs · 2h ago')
  })

  it('singular msg; falls back to created_at', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:05:00Z'))
    const s = active({ message_count: 1 })
    expect(railMeta(s)).toBe('1 msg · 5m ago')
  })

  it('omits the time clause when no timestamps at all', () => {
    const s = active({ message_count: 0, created_at: null, last_activity_at: null })
    expect(railMeta(s)).toBe('0 msgs')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sessionCard`
Expected: FAIL — `cardStory` is not exported.

- [ ] **Step 3: Implement**

In `frontend/src/utils/sessionCard.js`: change line 1 to also import the short formatter, and append the three functions. Do NOT touch `cardDescription` or `cardMeta`.

```javascript
import { formatRelative, formatRelativeShort } from '@/utils/formatDate.js'
```

```javascript
// Narrative line for home/library cards. Ended: summary (auto-stripped) -> 'Completed'.
// Active: trimmed preview or '' (caller renders its own placeholder).
// Structured signals (focus/mastered) never appear here — they are chips.
export function cardStory(session) {
  if (session.ended_at) {
    return stripAutoPrefix(session.last_session_summary) || 'Completed'
  }
  return (session.last_message_preview || '').trim()
}

// Structured signals for chip rendering on both surfaces. Focus first, mastered second.
// Chip appears only when its signal is meaningful (focus set / mastered > 0).
export function cardChips(session) {
  const chips = []
  const progress = session.progress
  if (progress && progress.focus_target_gap) {
    chips.push({ type: 'focus', label: progress.focus_target_gap })
  }
  const mastered = (progress && progress.mastered_count) || 0
  if (mastered > 0) {
    chips.push({ type: 'mastered', label: `${mastered} mastered`, count: mastered })
  }
  return chips
}

// Compact sidebar meta: "<n> msgs · <short-rel>".
export function railMeta(session) {
  const count = session.message_count || 0
  const left = `${count} ${count === 1 ? 'msg' : 'msgs'}`
  const ts = session.last_activity_at || session.created_at
  const rel = ts ? formatRelativeShort(ts) : ''
  return rel ? `${left} · ${rel}` : left
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sessionCard`
Expected: PASS — new describes green, all existing `cardDescription`/`cardMeta` tests still green.

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm run test:unit -- --run` then `npm run lint`

```bash
git add frontend/src/utils/sessionCard.js frontend/src/__tests__/sessionCard.test.js
git commit -m "feat(fe): add cardStory/cardChips/railMeta surface-specific card helpers"
```

---

### Task 3: `SessionChips.vue` shared component

**Files:**
- Create: `frontend/src/components/SessionChips.vue`
- Create: `frontend/src/__tests__/sessionChips.test.js`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/sessionChips.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionChips from '@/components/SessionChips.vue'

const FOCUS = { type: 'focus', label: 'ATP yield' }
const MASTERED = { type: 'mastered', label: '3 mastered', count: 3 }

describe('SessionChips', () => {
  it('card variant: visible Focus prefix and full mastered label', () => {
    const w = mount(SessionChips, { props: { chips: [FOCUS, MASTERED], variant: 'card' } })
    const focus = w.get('[data-testid="chip-focus"]')
    expect(focus.text()).toContain('Focus:')
    expect(focus.text()).toContain('ATP yield')
    expect(w.get('[data-testid="chip-mastered"]').text()).toContain('3 mastered')
  })

  it('rail variant: sr-only focus prefix; count-only mastered with sr-only suffix', () => {
    const w = mount(SessionChips, { props: { chips: [FOCUS, MASTERED], variant: 'rail' } })
    const focus = w.get('[data-testid="chip-focus"]')
    expect(focus.find('.chip-text').text()).toBe('ATP yield')
    expect(focus.find('.sr-only').text()).toContain('Focus:')
    const mastered = w.get('[data-testid="chip-mastered"]')
    expect(mastered.find('.chip-text').text()).toBe('3')
    expect(mastered.find('.sr-only').text()).toContain('mastered')
  })

  it('marks glyphs aria-hidden', () => {
    const w = mount(SessionChips, { props: { chips: [FOCUS, MASTERED] } })
    const glyphs = w.findAll('.chip-glyph')
    expect(glyphs.length).toBe(2)
    for (const g of glyphs) expect(g.attributes('aria-hidden')).toBe('true')
  })

  it('renders no chip elements for an empty array', () => {
    const w = mount(SessionChips, { props: { chips: [] } })
    expect(w.findAll('.chip')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sessionChips`
Expected: FAIL — cannot resolve `@/components/SessionChips.vue`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/SessionChips.vue`:

```vue
<script setup>
defineProps({
  /** Output of cardChips(session): [{ type, label, count? }]. */
  chips: { type: Array, required: true },
  /** 'rail' (sidebar, compact) | 'card' (home/library, full-size). */
  variant: { type: String, default: 'card' },
})
</script>

<template>
  <span class="chips" :class="`chips--${variant}`" data-testid="session-chips">
    <template v-for="chip in chips" :key="chip.type">
      <span v-if="chip.type === 'focus'" class="chip chip--focus" data-testid="chip-focus">
        <span class="chip-glyph" aria-hidden="true">&#9678;</span>
        <span v-if="variant !== 'card'" class="sr-only">Focus:</span>
        <!-- single text node so the "Focus: " space is a real space, not NBSP/condensed -->
        <span class="chip-text">{{ variant === 'card' ? `Focus: ${chip.label}` : chip.label }}</span>
      </span>
      <span
        v-else-if="chip.type === 'mastered'"
        class="chip chip--mastered"
        data-testid="chip-mastered"
      >
        <span class="chip-glyph" aria-hidden="true">&#10003;</span>
        <span class="chip-text">{{ variant === 'card' ? chip.label : chip.count }}</span>
        <span v-if="variant !== 'card'" class="sr-only"> mastered</span>
      </span>
    </template>
  </span>
</template>

<style scoped>
.chips {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  white-space: nowrap;
}

.chip--focus {
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  color: var(--color-accent-text);
}

.chip--mastered {
  background: transparent;
  border: 1px solid var(--signal-success, #0a7);
  color: var(--signal-success, #0a7);
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.chips--rail .chip {
  font-size: 0.6875rem;
  line-height: 1.5;
  padding: 0 0.4375rem;
}

.chips--rail .chip--focus .chip-text {
  max-width: 8rem;
}

.chips--card .chip {
  font-size: 0.75rem;
  padding: 0.125rem 0.5625rem;
}

.chips--card .chip--focus .chip-text {
  max-width: 18rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sessionChips`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm run test:unit -- --run` then `npm run lint`

```bash
git add frontend/src/components/SessionChips.vue frontend/src/__tests__/sessionChips.test.js
git commit -m "feat(fe): add SessionChips shared chip row (rail + card variants)"
```

---

### Task 4: Sidebar row migration — chips replace prose

**Files:**
- Modify: `frontend/src/components/sidebar/SidebarSessionRow.vue`
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Update + add the failing tests**

In `frontend/src/__tests__/sidebar.test.js`, REPLACE the test `'renders a description line and a meta line in each row'` (its rich-session store setup stays identical) with:

```javascript
it('renders chips and a compact meta line in each row', async () => {
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
  expect(row.find('.sb-row-chips').text()).toContain('ATP yield')
  expect(row.find('.sb-row-desc').exists()).toBe(false)
  expect(row.find('.sb-row-meta').text()).toBe('4 msgs · now')
})
```

Then ADD these four tests in the same describe block:

```javascript
it('signal-poor row renders no chips and never prose', async () => {
  const store = useSessionStore()
  store.sessions = [
    {
      id: 'a9',
      topic: 'Mitosis',
      created_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ended_at: null,
      message_count: 4,
      progress: { focus_target_gap: null, mastered_count: 0 },
      last_message_preview: 'That is correct! You listed all four stages.',
    },
  ]
  wrapper = mount(Sidebar)
  await flushPromises()
  const row = wrapper.find('[data-testid="sidebar-row-a9"]')
  expect(row.find('.sb-row-chips').exists()).toBe(false)
  expect(row.text()).not.toContain('That is correct!')
})

it('ended row follows the same chips rule — summary prose never renders', async () => {
  const store = useSessionStore()
  store.sessions = [
    {
      id: 'e1',
      topic: 'Krebs',
      created_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      message_count: 9,
      progress: { focus_target_gap: null, mastered_count: 2 },
      last_session_summary: '[auto] Covered the Krebs cycle',
    },
  ]
  wrapper = mount(Sidebar)
  await flushPromises()
  await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
  const row = wrapper.find('[data-testid="sidebar-row-e1"]')
  expect(row.find('.sb-row-chips [data-testid="chip-mastered"]').text()).toContain('2')
  expect(row.text()).not.toContain('Covered the Krebs cycle')
})

it('aria-describedby lists chips id then meta id when chips exist, meta only otherwise', async () => {
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
    {
      id: 'a9',
      topic: 'Mitosis',
      created_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ended_at: null,
      message_count: 4,
      progress: { focus_target_gap: null, mastered_count: 0 },
      last_message_preview: null,
    },
  ]
  wrapper = mount(Sidebar)
  await flushPromises()
  const richBtn = wrapper.get('[data-testid="sidebar-row-a1"] [data-testid="sidebar-row-open"]')
  expect(richBtn.attributes('aria-describedby')).toBe('sb-row-chips-a1 sb-row-meta-a1')
  const sparseBtn = wrapper.get('[data-testid="sidebar-row-a9"] [data-testid="sidebar-row-open"]')
  expect(sparseBtn.attributes('aria-describedby')).toBe('sb-row-meta-a9')
})

it('collapsed tooltip is built from chip labels', async () => {
  sidebarTest._setExpanded(false)
  const store = useSessionStore()
  store.sessions = [
    {
      id: 'a1',
      topic: 'Glycolysis',
      created_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ended_at: null,
      message_count: 4,
      progress: { focus_target_gap: 'ATP yield', mastered_count: 2 },
      last_message_preview: null,
    },
  ]
  wrapper = mount(Sidebar)
  await flushPromises()
  const btn = wrapper.get('[data-testid="sidebar-row-a1"] [data-testid="sidebar-row-open"]')
  expect(btn.attributes('title')).toBe('Glycolysis — Focus: ATP yield, 2 mastered')
})
```

Note: if the existing collapsed-mode tests around `sidebar.test.js:481` do extra viewport setup (`setViewport(...)`) before `_setExpanded(false)`, mirror that exact setup in the tooltip test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run "sidebar\.test"`
Expected: the replaced + 4 new tests FAIL (`.sb-row-chips` absent, meta still verbose); all other sidebar tests still pass.

- [ ] **Step 3: Migrate the component**

In `frontend/src/components/sidebar/SidebarSessionRow.vue`:

Script changes — replace the import line and the `description`/`descId`/`describedBy`/`tooltip` computeds:

```javascript
import { cardChips, railMeta } from '@/utils/sessionCard.js'
import SessionChips from '../SessionChips.vue'
```

```javascript
const chips = computed(() => cardChips(props.session))
const meta = computed(() => railMeta(props.session))

const chipsId = computed(() => `sb-row-chips-${props.session.id}`)
const metaId = computed(() => `sb-row-meta-${props.session.id}`)
const describedBy = computed(() => {
  const ids = []
  if (chips.value.length) ids.push(chipsId.value)
  ids.push(metaId.value)
  return ids.join(' ')
})

const tooltip = computed(() => {
  const topic = props.session.topic || 'Untitled'
  const parts = chips.value.map((c) => (c.type === 'focus' ? `Focus: ${c.label}` : c.label))
  return parts.length ? `${topic} — ${parts.join(', ')}` : topic
})
```

Template — replace the desc span (`<span v-if="description && !renaming" :id="descId" class="sb-row-desc">{{ description }}</span>`) with:

```html
<SessionChips
  v-if="chips.length && !renaming"
  :id="chipsId"
  class="sb-row-chips"
  :chips="chips"
  variant="rail"
/>
```

CSS — delete the `.sb-row-desc` and `.sb-row--ended .sb-row-desc` rules; add:

```css
.sb-row-chips {
  margin-top: 0.0625rem;
}

.sb-row--ended .sb-row-chips {
  opacity: 0.75;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run "sidebar"`
Expected: PASS — including `sidebarA11y` and `sidebarMobileStrip` files.

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm run test:unit -- --run` then `npm run lint`

```bash
git add frontend/src/components/sidebar/SidebarSessionRow.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): structured chips replace prose desc; compact rail meta"
```

---

### Task 5: HomeView migration — story + chips

**Files:**
- Modify: `frontend/src/views/HomeView.vue`
- Test: `frontend/src/__tests__/homeView.test.js`

- [ ] **Step 1: Update + add the failing tests**

In `frontend/src/__tests__/homeView.test.js`, REPLACE the test `'renders the layered card description (focus tier)'` with (it reuses the file's existing `makeRichRecent` helper):

```javascript
it('renders chips separately from the story line', async () => {
  apiAggregate.mockResolvedValue({ recent_topics: [makeRichRecent('r1')] })
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  const wrapper = mountView()
  await flushPromises()
  const card = wrapper.get('[data-testid="home-recent-r1"]')
  expect(card.find('.recent-chips').text()).toContain('Focus: ATP yield')
  expect(card.find('.recent-snippet').text()).not.toContain('Focus:')
})
```

ADD one test right after it:

```javascript
it('renders no chips element when the session has no signals', async () => {
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  store.sessions = [makeSession('a1', 'Trees')]
  apiAggregate.mockResolvedValue({ recent_topics: [makeRecent('a1', 'Trees')] })
  const wrapper = mountView()
  await flushPromises()
  expect(wrapper.get('[data-testid="home-recent-a1"]').find('.recent-chips').exists()).toBe(false)
})
```

Note: `makeRecent`/`makeSession`/`makeRichRecent` already exist in this file — keep their signatures, do not redefine them. If `makeRichRecent` sets a `last_message_preview`, the story assertion still holds (it checks for the absence of `Focus:`, not a specific preview string). The existing test `'shows summary snippet when present and fallback when null'` must keep passing unchanged (ended summary = story; `'No activity yet'` fallback preserved).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run homeView`
Expected: the replaced test FAILS (`.recent-chips` absent; snippet currently contains `Focus: ATP yield`).

- [ ] **Step 3: Migrate the view**

In `frontend/src/views/HomeView.vue`:

Imports (line ~156) — replace the sessionCard import and add the component import:

```javascript
import { cardStory, cardChips, cardMeta } from '../utils/sessionCard.js'
import SessionChips from '../components/SessionChips.vue'
```

Template — replace the snippet `<p>` block (lines 92-97) with:

```html
<p
  class="recent-snippet"
  :class="{
    'recent-snippet-muted': !cardStory(s),
    'recent-snippet-quote': !s.ended_at && !!cardStory(s),
  }"
>
  {{ cardStory(s) || 'No activity yet' }}
</p>
<SessionChips
  v-if="cardChips(s).length"
  class="recent-chips"
  :chips="cardChips(s)"
  variant="card"
/>
```

CSS — after the `.recent-snippet-muted` rule add:

```css
.recent-snippet-quote {
  font-style: italic;
}

.recent-snippet-quote::before {
  content: '\201C';
}

.recent-snippet-quote::after {
  content: '\201D';
}

.recent-chips {
  margin-top: 0.125rem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run homeView`
Expected: PASS — including the untouched fallback test (`'No activity yet'`, ended summary).

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm run test:unit -- --run` then `npm run lint`

```bash
git add frontend/src/views/HomeView.vue frontend/src/__tests__/homeView.test.js
git commit -m "feat(home): recent cards split narrative story from signal chips"
```

---

### Task 6: SessionsLibraryView migration — story + chips

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue`
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js`

- [ ] **Step 1: Update the failing tests**

In `frontend/src/__tests__/sessionsLibraryView.test.js`, REPLACE the assertion lines of `'renders rich cards from the library page'` (the `item()` factory has `last_message_preview: null` and `focus_target_gap: 'gap-<id>'`):

```javascript
it('renders rich cards from the library page', async () => {
  sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a'), item('b')]))
  const wrapper = mount(SessionsLibraryView, { global: { stubs } })
  await flushPromises()
  expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(2)
  const card = wrapper.get('[data-testid="library-card-a"]')
  expect(card.find('.library-chips').text()).toContain('Focus: gap-a')
  expect(card.find('.library-desc').text()).toBe('No activity yet')
})
```

The ended-summary test (`'ended card shows the auto-stripped summary, not "Completed"'`) stays byte-identical — `cardStory` keeps that behavior.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sessionsLibraryView`
Expected: FAIL — `.library-chips` absent; `.library-desc` currently reads `Focus: gap-a`.

- [ ] **Step 3: Migrate the view**

In `frontend/src/views/SessionsLibraryView.vue`:

Imports (line 5) — replace with:

```javascript
import { cardStory, cardChips, cardMeta } from '@/utils/sessionCard.js'
import SessionChips from '@/components/SessionChips.vue'
```

Template — replace `<p class="library-desc">{{ cardDescription(s) || 'No activity yet' }}</p>` (line 178) with:

```html
<p
  class="library-desc"
  :class="{ 'library-desc-quote': !s.ended_at && !!cardStory(s) }"
>
  {{ cardStory(s) || 'No activity yet' }}
</p>
<SessionChips
  v-if="cardChips(s).length"
  class="library-chips"
  :chips="cardChips(s)"
  variant="card"
/>
```

CSS — after the `.library-desc` rule add:

```css
.library-desc-quote {
  font-style: italic;
}

.library-desc-quote::before {
  content: '\201C';
}

.library-desc-quote::after {
  content: '\201D';
}

.library-chips {
  margin-top: 0.125rem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sessionsLibraryView`
Expected: PASS.

- [ ] **Step 5: Full suite + lint + commit**

Run: `npm run test:unit -- --run` then `npm run lint`

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/__tests__/sessionsLibraryView.test.js
git commit -m "feat(library): cards split narrative story from signal chips"
```

---

### Task 7: Delete `cardDescription` + stale-selector sweep

**Files:**
- Modify: `frontend/src/utils/sessionCard.js`
- Modify: `frontend/src/__tests__/sessionCard.test.js`

- [ ] **Step 1: Delete the dead code**

In `frontend/src/utils/sessionCard.js` delete the whole `cardDescription` function and its comment block (the `// Primary description line...` comment). In `frontend/src/__tests__/sessionCard.test.js` delete the `describe('cardDescription — active precedence')` and `describe('cardDescription — ended')` blocks and remove `cardDescription` from the import list.

- [ ] **Step 2: Repo-wide stale-reference sweep (vitest ≠ e2e lesson)**

Run from repo root and confirm each:

```bash
grep -rn "cardDescription" frontend/        # expect: zero hits
grep -rn "sb-row-desc" frontend/            # expect: zero hits (id prefix renamed to sb-row-chips-)
grep -rn "sb-row-desc\|cardDescription\|recent-snippet\|library-desc\|sidebar-row-" frontend/e2e/   # expect: no hits referencing removed things
```

`frontend/e2e/` has 6 Playwright specs that vitest cannot validate. Any hit on a removed selector must be fixed before commit. Hits on selectors that still exist (`recent-snippet`, `library-desc`, `sidebar-row-*` testids — all preserved) are fine.

- [ ] **Step 3: Run the FULL suite to verify nothing references the removed API**

Run: `npm run test:unit -- --run`
Expected: ALL files pass (449+ tests). A failure naming `cardDescription` means a consumer was missed — fix the consumer, not the test.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean exit AND `git status` shows no lint-dirtied files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/sessionCard.js frontend/src/__tests__/sessionCard.test.js
git commit -m "refactor(fe): delete cardDescription — all surfaces on story/chips/meta API"
```

---

### Task 8: Final verification gate

- [ ] **Step 1: Full frontend suite + lint, clean tree**

Run from `frontend/`: `npm run test:unit -- --run` and `npm run lint`
Expected: all green; `git status` clean.

- [ ] **Step 2: Diff scope check**

Run: `git diff --stat dev`
Expected: ONLY `frontend/src/**` + 2 docs files (spec + this plan). Zero backend/OpenAPI/contract changes.

- [ ] **Step 3: Manual live smoke (user-visible, not headless)**

With `npm run dev` + the real account: (a) sidebar rows show chips or 2-line compact rows, never prose; (b) meta reads `"N msgs · 2h ago"` without truncation at default rail width; (c) home cards show story + chips + verbose meta; ended card shows summary + Continue; (d) `/sessions` library cards match home; (e) collapsed sidebar tooltip shows `topic — Focus: …, N mastered`.

- [ ] **Step 4: Push and open PR into `dev`**

```bash
git push -u origin feat/card-differentiation
gh pr create --base dev --title "feat(ui): differentiate sidebar rail from home/library cards" --body "Per docs/superpowers/specs/2026-06-11-card-differentiation-design.md — sidebar goes structured-only (chips or nothing, compact meta), home/library cards go narrative (story + chips + verbose meta). Frontend-only."
```

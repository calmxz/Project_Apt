# Frontend Critique Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 11 priority issues and the actionable minors from the 2026-09-10 frontend critique (score 23/40) without changing product semantics.

**Architecture:** Every task is a frontend-only, component-local change with a vitest red/green cycle. No API contract changes, no backend changes, no migration. One branch, one commit per task, PR to `dev` at the end.

**Tech Stack:** Vue 3 SFC, Vite, vitest + @vue/test-utils, pinia, PrimeVue (InputText), PrimeIcons, CSS custom properties in `frontend/src/assets/base.css`.

**Spec:** `docs/reviews/2026-09-10-frontend-critique.md` (findings, severities, evidence, retractions).

## Global Constraints

- Branch first: `git checkout -b fix/frontend-critique-2026-09-10` from `dev`.
- Run tests from `frontend/`: `npm run test:unit -- --run <file>` for one file, `npm run test:unit -- --run` for all. Lint: `npm run lint`.
- No emojis in code or comments. ASCII only in test output.
- Do not add a `Claude-Session` trailer or any AI attribution to commits.
- Do not touch `backend/`, `docs/api/openapi.yaml`, or `backend/contracts/`.
- Do not start a session or send a chat message while verifying in the browser: each turn is a paid LLM call. Browser verification is read-only page loads.
- Keep `data-testid` attributes referenced by `frontend/e2e/*.spec.js` intact (grep before renaming any).
- Executor tier per task is listed in the task title; when in doubt, escalate.

## Decisions (resolved 2026-09-10)

- **Mastered/gap reconciliation rule:** backend most-recent-event-wins, tracked in GitHub Issue #288. Task 2 below is WITHDRAWN; do not implement the UI "Conflicting" state.
- **Doubled level question** (tutor prose + consent card): backend prompt fix, tracked in GitHub Issue #287 with the paid smoke gate. Not in this plan.
- **"Draft - not legal advice" line** on ToS/Privacy: REMOVE. Folded into Task 6, which also updates `legalViews.test.js`.
- **`.impeccable/` snapshots:** gitignored 2026-09-10.
- **Quick-pick chips auto-starting a session:** rejected; turns one click into a paid call.
- **Execution:** Tasks 1 and 3-13 executed 2026-09-10 on `fix/frontend-critique-2026-09-10` via parallel executors (commit steps deliberately skipped pending a user UI pass). Task 14 steps 1 and 3 done (vitest 870/870, lint clean, detect rule ids unchanged). Still owed: Task 10 step 5 live reset-link smoke, the visual verify steps in Tasks 3/5/6/13, Task 14 steps 2, 4, 5.

---

### Task 1: Usage panel must not say "No usage yet" above a cost list (executor-sonnet)

**Files:**
- Modify: `frontend/src/components/profile/UsagePanel.vue:67`
- Test: `frontend/src/__tests__/usagePanel.test.js`

**Interfaces:**
- Consumes: `usage` prop shape from existing tests (`daily`, `today_spend_usd`, `top_sessions`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `describe('UsagePanel', ...)`:

```js
  it('does not show the empty-state copy when top_sessions has rows', () => {
    const w = factory(
      usage({
        daily: [],
        today_spend_usd: 0,
        top_sessions: [{ session_id: 's1', topic: 'CSS', cost_usd: 0.02 }],
      }),
    )
    expect(w.find('[data-testid="usage-empty"]').exists()).toBe(false)
    expect(w.text()).toContain('Most expensive sessions')
  })

  it('shows the empty-state copy only when there is no spend anywhere', () => {
    const w = factory(usage({ daily: [], today_spend_usd: 0, top_sessions: [] }))
    expect(w.find('[data-testid="usage-empty"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Most expensive sessions')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/usagePanel.test.js`
Expected: first new test FAILS (`usage-empty` exists while list renders).

- [ ] **Step 3: Write minimal implementation**

In `UsagePanel.vue` replace line 67:

```js
const noSpend = computed(
  () =>
    maxDay.value === 0 &&
    props.usage.today_spend_usd === 0 &&
    (props.usage.top_sessions || []).length === 0,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/usagePanel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/profile/UsagePanel.vue frontend/src/__tests__/usagePanel.test.js
git commit -m "fix(usage): hide empty-state copy when top sessions exist"
```

---

### Task 2: WITHDRAWN - superseded by GitHub Issue #288 (backend most-recent-event-wins)

Kept for the record only. Skip this task entirely; the original UI-side design follows.

**Files:**
- Modify: `frontend/src/components/settings/ProfileTab.vue:85-130` (template), `:176-200` (script)
- Test: `frontend/src/__tests__/profileTab.test.js`

**Interfaces:**
- Consumes: `data.combined_mastered_concepts[]` and `data.combined_confirmed_gaps[]`, each `{ concept, count, first_seen_session_id }`.
- Produces: three computed lists `masteredOnly`, `gapsOnly`, `conflicting` (array of `{ concept, mastered, gap }` where `mastered` and `gap` are the original items). Stat tiles at `:46` and `:52` keep using the raw arrays (counts do not change).

- [ ] **Step 1: Write the failing test**

Add to `profileTab.test.js` inside the existing `describe` (reuse `seedUser`, `stubs`, and the `vi.spyOn(profileApi, 'getAggregateProfile')` pattern already used in the file):

```js
  it('renders a concept present in both lists once, in a Conflicting section, linking both sessions', async () => {
    seedUser()
    const payload = nonEmptyAggregatePayload()
    payload.combined_mastered_concepts.push({
      concept: 'covalent bonds',
      count: 1,
      first_seen_session_id: 'sM',
    })
    payload.combined_confirmed_gaps.push({
      concept: 'covalent bonds',
      count: 1,
      first_seen_session_id: 'sG',
    })
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(payload)
    const w = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    const conflicts = w.get('[data-testid="agg-conflicting"]')
    expect(conflicts.text()).toContain('covalent bonds')
    const links = conflicts.findAllComponents(RouterLinkStub).map((l) => l.props('to'))
    expect(links).toEqual(
      expect.arrayContaining([
        { name: 'session-profile', params: { id: 'sM' } },
        { name: 'session-profile', params: { id: 'sG' } },
      ]),
    )
    expect(w.get('[data-testid="agg-mastered"]').text()).not.toContain('covalent bonds')
    expect(w.get('[data-testid="agg-gaps"]').text()).not.toContain('covalent bonds')
  })

  it('omits the Conflicting section when the lists are disjoint', async () => {
    seedUser()
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(nonEmptyAggregatePayload())
    const w = mount(ProfileTab, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-testid="agg-conflicting"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/profileTab.test.js`
Expected: FAIL, `agg-conflicting` not found.

- [ ] **Step 3: Write minimal implementation**

Script (after `const data = ref(null)`):

```js
const norm = (s) => (s || '').trim().toLowerCase()

const conflicting = computed(() => {
  const gaps = new Map(
    (data.value?.combined_confirmed_gaps || []).map((g) => [norm(g.concept), g]),
  )
  return (data.value?.combined_mastered_concepts || [])
    .filter((m) => gaps.has(norm(m.concept)))
    .map((m) => ({ concept: m.concept, mastered: m, gap: gaps.get(norm(m.concept)) }))
})
const conflictKeys = computed(() => new Set(conflicting.value.map((c) => norm(c.concept))))
const masteredOnly = computed(() =>
  (data.value?.combined_mastered_concepts || []).filter((m) => !conflictKeys.value.has(norm(m.concept))),
)
const gapsOnly = computed(() =>
  (data.value?.combined_confirmed_gaps || []).filter((g) => !conflictKeys.value.has(norm(g.concept))),
)
```

Template: change the two `v-for` sources at `:94` and `:118` to `masteredOnly` and `gapsOnly`, and the two `v-if="!... .length"` empties at `:91` and `:115` to `!masteredOnly.length` / `!gapsOnly.length`. Insert after the closing `</div>` of `.two-col`:

```html
        <section v-if="conflicting.length" class="col conflict" data-testid="agg-conflicting">
          <h2 class="section-title">
            <i class="pi pi-exclamation-circle col-icon" aria-hidden="true" />
            Conflicting
          </h2>
          <p class="muted">
            Mastered in one session, still a gap in another. Open either session to settle it.
          </p>
          <ul class="chip-list">
            <li v-for="c in conflicting" :key="`c-${c.concept}`" class="chip chip-conflict">
              <span class="chip-name">{{ c.concept }}</span>
              <router-link
                :to="{ name: 'session-profile', params: { id: c.mastered.first_seen_session_id } }"
                class="chip-meta"
                :title="`mastered in ${c.mastered.count} ${c.mastered.count === 1 ? 'session' : 'sessions'}`"
              >
                mastered
              </router-link>
              <router-link
                :to="{ name: 'session-profile', params: { id: c.gap.first_seen_session_id } }"
                class="chip-meta"
                :title="`a gap in ${c.gap.count} ${c.gap.count === 1 ? 'session' : 'sessions'}`"
              >
                gap
              </router-link>
            </li>
          </ul>
        </section>
```

Scoped CSS (next to `.chip-gap`):

```css
.chip-conflict {
  background: color-mix(in srgb, var(--signal-warning) 14%, var(--color-surface));
  border-color: color-mix(in srgb, var(--signal-warning) 45%, var(--color-border));
}
.conflict {
  margin-top: 1.5rem;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/profileTab.test.js`
Expected: PASS, including all pre-existing tests (they use disjoint payloads).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/ProfileTab.vue frontend/src/__tests__/profileTab.test.js
git commit -m "fix(profile): surface concepts that are both mastered and a gap as Conflicting"
```

---

### Task 3: Ended-session banner reads as completion, not warning (executor-sonnet)

**Files:**
- Modify: `frontend/src/components/SessionEndedBanner.vue:7-8,29,47-70,96-100`
- Test: `frontend/src/__tests__/sessionEndedBanner.test.js` (create)

**Interfaces:**
- Consumes: `formatRelative(iso)` from `frontend/src/utils/formatDate.js:31`.
- Produces: same props/emits (`endedAt`, `loading`, `hasGaps`; `resume`, `resume-gaps`). `SessionView.vue` needs no change.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionEndedBanner from '@/components/SessionEndedBanner.vue'

afterEach(() => vi.useRealTimers())

describe('SessionEndedBanner', () => {
  it('uses relative time and completion copy', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'))
    const w = mount(SessionEndedBanner, { props: { endedAt: '2026-07-30T03:45:00Z' } })
    const text = w.text()
    expect(text).toMatch(/Session ended \d+ (weeks|months) ago/)
    expect(text).not.toContain('GMT')
    expect(text).not.toContain('Read-only')
    expect(text).toContain('Continue the topic in a new session')
  })

  it('emits resume and resume-gaps', async () => {
    const w = mount(SessionEndedBanner, { props: { endedAt: '2026-07-30T03:45:00Z', hasGaps: true } })
    await w.get('[data-testid="session-resume"]').trigger('click')
    await w.get('[data-testid="session-resume-gaps"]').trigger('click')
    expect(w.emitted('resume')).toHaveLength(1)
    expect(w.emitted('resume-gaps')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/sessionEndedBanner.test.js`
Expected: FAIL on the copy assertions.

- [ ] **Step 3: Write minimal implementation**

Template lines 7-8:

```html
      <p class="line">Session ended {{ formatRelative(endedAt) }}.</p>
      <p class="sub">This transcript is kept as-is. Continue the topic in a new session to keep building the profile.</p>
```

Script import: `import { formatRelative } from '../utils/formatDate.js'` (drop `formatDate`).

Icon: change `pi-clock` to `pi-check-circle`.

Styles: replace the hardcoded amber with neutral tokens.

```css
.ended-banner {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1.125rem;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}

.banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  background: var(--color-success-text);
  color: var(--color-background);
  font-size: 1rem;
  flex-shrink: 0;
}

.resume-btn {
  /* keep existing layout rules; change only color */
  background: var(--color-accent-strong);
  color: #fff;
}
```

Leave `.gaps-btn` as the visually secondary variant (outline: `background: transparent; color: var(--color-accent-text); border: 1px solid var(--color-border-strong);`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/sessionEndedBanner.test.js src/__tests__/sessionView.test.js`
Expected: PASS. If `sessionView.test.js` asserts on the old banner copy, update that assertion to the new copy in the same commit.

- [ ] **Step 5: Verify visually**

Load `http://localhost:5173/session/db4c2a1b20814cada3a4541b8fa4d5f8` (ended Mitosis session) in dark and light. Banner should be neutral surface with a green check and one filled + one outlined button. Do not click Resume.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SessionEndedBanner.vue frontend/src/__tests__/sessionEndedBanner.test.js frontend/src/__tests__/sessionView.test.js
git commit -m "fix(session): ended banner uses relative time and completion tone"
```

---

### Task 4: One loading vocabulary: skeletons, no bare "Loading..." text (executor-sonnet)

**Files:**
- Create: `frontend/src/components/LibrarySkeletonGrid.vue`
- Modify: `frontend/src/views/SessionsLibraryView.vue:229,288`, `frontend/src/views/HomeView.vue:5`
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js`, `frontend/src/__tests__/homeView.test.js`

**Interfaces:**
- Produces: `<LibrarySkeletonGrid :count="6" />`, `aria-hidden`, class `library-grid` so it inherits the real grid's columns via the parent's scoped rule (add `:deep()` if the scoped rule does not reach it).

- [ ] **Step 1: Write the failing tests**

In `sessionsLibraryView.test.js` the module-level `vi.mock('@/services/sessionsApi.js', () => ({ getSessionLibrary: vi.fn() }))` at line 20 is shared by every test; import it as `import { getSessionLibrary } from '@/services/sessionsApi.js'` if the file does not already. Add:

```js
  it('renders a skeleton grid, not text, while the first page loads', async () => {
    getSessionLibrary.mockReturnValue(new Promise(() => {}))
    const w = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(w.find('[data-testid="library-loading"]').exists()).toBe(false)
    expect(w.find('[data-testid="library-skeleton"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Loading...')
  })
```

In `homeView.test.js` there is an existing test at line 63, `it('shows loading state', ...)`, that sets `store.loading = true` and asserts the old text. Replace its body with:

```js
  it('does not render bare Loading text while the store is loading', () => {
    const store = useSessionStore()
    store.loading = true
    store.sessions = []
    const w = mountView()
    expect(w.text()).not.toContain('Loading...')
    expect(w.find('[data-testid="home-mode-quick"]').exists()).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/__tests__/sessionsLibraryView.test.js src/__tests__/homeView.test.js`
Expected: both new tests FAIL.

- [ ] **Step 3: Write minimal implementation**

`LibrarySkeletonGrid.vue`:

```html
<script setup>
defineProps({ count: { type: Number, default: 6 } })
</script>

<template>
  <ul class="library-grid skel-grid" aria-hidden="true" data-testid="library-skeleton">
    <li v-for="i in count" :key="i" class="skel-card">
      <span class="skel-line skel-topic" />
      <span class="skel-line skel-body" />
      <span class="skel-line skel-body short" />
      <span class="skel-line skel-meta" />
    </li>
  </ul>
</template>

<style scoped>
.skel-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 1rem;
}
.skel-card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 7rem;
}
.skel-line {
  display: block;
  height: 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  animation: skel-pulse 1.4s ease-in-out infinite;
}
.skel-topic { width: 55%; height: 0.9rem; }
.skel-body { width: 92%; }
.skel-body.short { width: 70%; }
.skel-meta { width: 40%; height: 0.6rem; margin-top: auto; }
@keyframes skel-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .skel-line { animation: none; }
}
</style>
```

`SessionsLibraryView.vue:229`: replace the `<p ... data-testid="library-loading">Loading...</p>` with `<LibrarySkeletonGrid v-if="loading && !items.length" :count="6" />` and import the component. Line 288 (`Loading more...`): replace with `<LibrarySkeletonGrid v-if="loading" :count="3" />`.

`HomeView.vue:5`: delete the `Loading...` `<p>` and change the following `v-else-if` to `v-if`, and the `<template v-else>` stays. Safe because the duplicate-topic intercept does not read `store.sessions`: `useStartFlow.begin()` calls `store.lookupTopic()` on the server (`frontend/src/composables/useStartFlow.js:15-37`), so submitting before the sidebar list has loaded still intercepts duplicates.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/__tests__/sessionsLibraryView.test.js src/__tests__/homeView.test.js src/__tests__/homeViewBootSilent.test.js`
Expected: PASS. If an existing test asserts `library-loading`, update it to `library-skeleton`.

- [ ] **Step 5: Check e2e selectors**

Run from repo root: `grep -rn "library-loading\|Loading\.\.\." frontend/e2e` and expect no matches (verified 2026-09-10; re-check).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/LibrarySkeletonGrid.vue frontend/src/views/SessionsLibraryView.vue frontend/src/views/HomeView.vue frontend/src/__tests__/
git commit -m "fix(loading): replace bare Loading text with skeleton grid"
```

---

### Task 5: Muted text token clears WCAG AA in dark mode (executor-sonnet)

**Files:**
- Modify: `frontend/src/assets/base.css:141,176`
- Test: `frontend/src/__tests__/tokenContrast.test.js` (create)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../assets/base.css'), 'utf8')

function hex(varName, block) {
  const re = new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{6})`, 'g')
  const matches = [...block.matchAll(re)].map((m) => m[1])
  if (!matches.length) throw new Error(`token ${varName} not found`)
  return matches
}
function lum(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe('base.css tokens', () => {
  it('dark --color-text-faint on --color-background is >= 4.5:1 in every dark block', () => {
    const dark = css.slice(css.indexOf("[data-theme='dark']"))
    const bgs = hex('--color-background', dark)
    const faints = hex('--color-text-faint', dark)
    expect(faints.length).toBe(bgs.length)
    faints.forEach((f, i) => expect(ratio(f, bgs[i])).toBeGreaterThanOrEqual(4.5))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/tokenContrast.test.js`
Expected: FAIL, ratio about 3.17. (Verified 2026-09-10: exactly two dark `--color-background` definitions at `base.css:135` and `:170`, pairing with `--color-text-faint` at `:141` and `:176`; if the length assertion trips instead, re-grep `color-background:` before trusting it.)

- [ ] **Step 3: Write minimal implementation**

In `base.css` change both dark occurrences (line 141 and line 176) from `--color-text-faint: #5b6480;` to `--color-text-faint: #7d87a6;` (about 4.7:1 on `#0f1220`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/tokenContrast.test.js`
Expected: PASS.

- [ ] **Step 5: Verify visually**

Load `/session/1f17b2cb691748ec94304a873f2b7a90` in dark mode; the `TUTOR` role tag, composer hint row, and sidebar `(1)` count should be legibly lighter and still visibly secondary.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assets/base.css frontend/src/__tests__/tokenContrast.test.js
git commit -m "fix(tokens): raise dark --color-text-faint to AA contrast"
```

---

### Task 6: Legal pages get rhythm, a way back, and lose the draft notice (executor-sonnet)

**Files:**
- Modify: `frontend/src/views/TosView.vue`, `frontend/src/views/PrivacyView.vue`, `frontend/src/legal/terms-of-service.md`, `frontend/src/legal/privacy-policy.md`
- Test: `frontend/src/__tests__/legalViews.test.js`

**Decision applied:** the "Draft - not legal advice. Seek professional review before large-scale data collection." line is removed from both markdown sources (user decision 2026-09-10). The `Version ... Effective ...` line stays.

**Interfaces:**
- Consumes: `BackButton` (`frontend/src/components/BackButton.vue`, props `label`, `fallback`).

- [ ] **Step 1: Write the failing test**

Append to `legalViews.test.js` (the file mounts without a router; stub `BackButton`):

```js
const stubs = { BackButton: { props: ['label', 'fallback'], template: '<a data-testid="back-button">{{ label }}</a>' } }

  it('ToS and Privacy render a back control above the article', () => {
    for (const View of [TosView, PrivacyView]) {
      const w = mount(View, { global: { stubs } })
      expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
      expect(w.find('article.legal').exists()).toBe(true)
    }
  })

  it('ToS and Privacy no longer carry the draft notice', () => {
    for (const View of [TosView, PrivacyView]) {
      const w = mount(View, { global: { stubs } })
      expect(w.text()).not.toContain('not legal advice')
      expect(w.text()).toMatch(/Version \d{4}-\d{2}-\d{2}/)
    }
  })
```

Replace the two existing `renders the ... draft banner` tests (they assert `not legal advice` is present) with the test above. Update the remaining `mount(...)` call to pass `{ global: { stubs } }` so the unstubbed `BackButton` does not need a router.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/legalViews.test.js`
Expected: FAIL, no back button.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/legal/terms-of-service.md` and `frontend/src/legal/privacy-policy.md`, delete the bold line beginning `**Draft` (the "not legal advice" notice). Leave every other line intact.

Both views, template:

```html
<template>
  <section class="legal-page">
    <BackButton label="Back" fallback="/" />
    <article class="legal" v-html="html" />
  </section>
</template>
```

Add `import BackButton from '../components/BackButton.vue'` to both scripts.

Both views, scoped style (replace the existing `.legal` block):

```css
.legal-page {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}
.legal {
  margin-top: 1.5rem;
  line-height: var(--lh-body);
}
.legal :deep(h1) {
  font-family: var(--font-display);
  font-size: 2rem;
  letter-spacing: var(--tracking-tight);
  margin-bottom: 0.5rem;
}
.legal :deep(h2) {
  font-family: var(--font-display);
  font-size: 1.25rem;
  margin-top: 2rem;
  margin-bottom: 0.5rem;
}
.legal :deep(p),
.legal :deep(ul) {
  margin-bottom: 1rem;
  color: var(--color-text);
}
.legal :deep(ul) {
  padding-left: 1.25rem;
}
.legal :deep(li + li) {
  margin-top: 0.25rem;
}
@media (max-width: 600px) {
  .legal-page {
    padding: 1.25rem 1rem 3rem;
  }
}
```

(`base.css` has no `--space-*` tokens; rem values are intentional.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/legalViews.test.js`
Expected: PASS. Also grep `frontend/e2e` and `backend/tests` for `not legal advice` and update any assertion that depended on the notice.

- [ ] **Step 5: Verify visually**

Load `/tos` and `/privacy`; headings have breathing room, back button top-left works.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/TosView.vue frontend/src/views/PrivacyView.vue frontend/src/legal/ frontend/src/__tests__/legalViews.test.js
git commit -m "fix(legal): heading rhythm, back control, drop draft notice on ToS and Privacy"
```

---

### Task 7: "Retake onboarding" is a preference, not a danger (executor-sonnet)

**Files:**
- Modify: `frontend/src/components/settings/AccountTab.vue:116-132` and its `.danger*` styles
- Test: `frontend/src/__tests__/accountTab.test.js:54-55`

**Interfaces:** `data-testid="settings-retake-onboarding"` stays (e2e-safe). `settings-danger` is renamed to `settings-preferences`; grep confirms it is referenced only in `accountTab.test.js`.

- [ ] **Step 1: Write the failing test**

In `accountTab.test.js`, change `'settings-danger'` in the testid list at line 54 to `'settings-preferences'` and add:

```js
  it('presents retake onboarding as a neutral preference, not a danger zone', async () => {
    const w = mountTab() // reuse the file's factory
    await flushPromises()
    const section = w.get('[data-testid="settings-preferences"]')
    expect(section.text()).not.toMatch(/danger/i)
    expect(section.text()).not.toMatch(/removes your local profile/i)
    expect(section.text()).toContain('Tutor preferences')
    expect(section.get('[data-testid="settings-retake-onboarding"]').text()).toContain('Edit name and feedback style')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/accountTab.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Replace lines 116-132:

```html
  <section class="card" data-testid="settings-preferences">
    <h2 class="card-title">
      <i class="pi pi-sliders-h card-icon" aria-hidden="true" />
      Tutor preferences
    </h2>
    <p class="card-sub">
      Re-run the two-step setup to change your display name or how the tutor gives feedback. Sessions are not affected.
    </p>
    <router-link
      to="/onboarding?retake=1"
      class="secondary-link"
      data-testid="settings-retake-onboarding"
    >
      <span>Edit name and feedback style</span>
      <i class="pi pi-arrow-right" aria-hidden="true" />
    </router-link>
  </section>
```

Delete the `.danger`, `.danger-title`, `.danger-text`, `.danger-link` rules. Add:

```css
.card-sub {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
.secondary-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-strong);
  color: var(--color-accent-text);
  font-weight: 600;
  font-size: 0.875rem;
  text-decoration: none;
}
.secondary-link:hover {
  border-color: var(--color-accent);
}
.secondary-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/accountTab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/AccountTab.vue frontend/src/__tests__/accountTab.test.js
git commit -m "fix(settings): retake onboarding is a preference, not a danger zone"
```

---

### Task 8: Library card previews never show LaTeX source or one-word previews (executor-sonnet)

**Files:**
- Modify: `frontend/src/utils/sessionCard.js:22-28`
- Test: `frontend/src/__tests__/sessionCard.test.js`

**Interfaces:**
- Produces: `cardStory(session)` unchanged signature. Exports new `cleanPreview(text)` for direct testing.

- [ ] **Step 1: Write the failing test**

Append to `sessionCard.test.js`:

```js
import { cleanPreview } from '@/utils/sessionCard.js'

describe('cleanPreview', () => {
  it('replaces display and inline math with [formula]', () => {
    expect(cleanPreview('Solve $$x = \\frac{-b}{2a}$$ then $y^2$ next')).toBe(
      'Solve [formula] then [formula] next',
    )
  })
  it('passes through plain text and null', () => {
    expect(cleanPreview('hello there')).toBe('hello there')
    expect(cleanPreview(null)).toBe('')
  })
})

describe('cardStory (active)', () => {
  it('falls back to the summary when the preview is very short', () => {
    expect(
      cardStory(active({ last_message_preview: 'okay', last_session_summary: '[auto] Covered routers.' })),
    ).toBe('Covered routers.')
  })
  it('keeps a short preview when there is no summary', () => {
    expect(cardStory(active({ last_message_preview: 'okay' }))).toBe('okay')
  })
  it('cleans math out of the preview', () => {
    expect(cardStory(active({ last_message_preview: 'Here: $$a^2+b^2=c^2$$' }))).toBe('Here: [formula]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/sessionCard.test.js`
Expected: FAIL, `cleanPreview` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
const DISPLAY_MATH_RE = /\$\$[\s\S]*?\$\$/g
const INLINE_MATH_RE = /\$[^$\n]+?\$/g
const SHORT_PREVIEW = 12

export function cleanPreview(text) {
  return (text || '')
    .replace(DISPLAY_MATH_RE, '[formula]')
    .replace(INLINE_MATH_RE, '[formula]')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cardStory(session) {
  if (session.ended_at) {
    return stripAutoPrefix(session.last_session_summary) || 'Completed'
  }
  const preview = cleanPreview(session.last_message_preview)
  const summary = stripAutoPrefix(session.last_session_summary)
  if (preview.length < SHORT_PREVIEW && summary) return summary
  return preview
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/sessionCard.test.js src/__tests__/sessionsLibraryView.test.js src/__tests__/homeView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/sessionCard.js frontend/src/__tests__/sessionCard.test.js
git commit -m "fix(cards): strip math source and short previews from card story"
```

---

### Task 9: Single `<main>` landmark on the sessions library (executor-haiku)

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue:181` and its closing tag, plus the `.library` scoped selector if it is element-qualified
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js`

- [ ] **Step 1: Write the failing test**

```js
  it('does not render a nested main landmark', () => {
    const w = mountLoaded() // reuse the file's loaded-state helper
    expect(w.findAll('main').length).toBe(0)
    expect(w.find('section.library').exists()).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/sessionsLibraryView.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Change `<main class="library">` to `<section class="library" aria-labelledby="library-title">`, its matching `</main>` to `</section>`, and give the `<h1>` inside `.library-head` `id="library-title"`. Confirm the scoped style uses `.library` not `main.library`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/sessionsLibraryView.test.js`
Expected: PASS.

- [ ] **Step 5: Confirm e2e is unaffected**

Run from repo root: `grep -rn "locator('main\|getByRole('main" frontend/e2e` and expect no matches.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/__tests__/sessionsLibraryView.test.js
git commit -m "fix(a11y): remove nested main landmark on sessions library"
```

---

### Task 10: Reset-password page shows an expired-link state when no recovery session exists (executor-sonnet)

**Files:**
- Modify: `frontend/src/views/ResetPasswordView.vue:10-59` (template), `:62-95` (script)
- Test: `frontend/src/__tests__/resetPasswordView.test.js`

**Interfaces:**
- Consumes: `useAuthStore()` with `session` (ref, null when no recovery session) and `ready` (ref) from `frontend/src/stores/auth.js:17-19`. Supabase turns a recovery link into a session on init, so "no session after ready" means "no valid link".

- [ ] **Step 1: Write the failing test**

Add to `resetPasswordView.test.js`:

```js
  it('shows the expired-link state instead of the form when there is no recovery session', async () => {
    const auth = useAuthStore()
    auth.ready = true
    auth.session = null
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-testid="reset-form"]').exists()).toBe(false)
    expect(w.get('[data-testid="reset-no-session"]').text()).toMatch(/expired|invalid/i)
    expect(w.find('[data-testid="reset-to-forgot"]').exists()).toBe(true)
  })

  it('shows the form when a recovery session is present', async () => {
    const auth = useAuthStore()
    auth.ready = true
    auth.session = { user: { id: 'u1' } }
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-testid="reset-form"]').exists()).toBe(true)
  })
```

Update the file's existing `beforeEach` so tests that exercise the form seed `auth.ready = true; auth.session = { user: { id: 'u1' } }` (otherwise the new gate hides the form).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/resetPasswordView.test.js`
Expected: first new test FAILS.

- [ ] **Step 3: Write minimal implementation**

Script additions. Supabase exchanges the recovery hash asynchronously after `init()`, so the hash itself counts as evidence of a valid link; the form must never hide while `#...type=recovery` is in the URL.

```js
const recoveryHash = ref(
  typeof window !== 'undefined' && window.location.hash.includes('type=recovery'),
)
const hasRecovery = computed(() => recoveryHash.value || !auth.ready || !!auth.session)
```

Add a third test that seeds `window.location.hash = '#access_token=x&type=recovery'` with `auth.ready = true; auth.session = null` and asserts the form renders; reset the hash in `afterEach`.

Template: wrap the existing `<form ...>` in `<form v-if="hasRecovery" ...>` and add after it:

```html
    <div v-else class="form" data-testid="reset-no-session">
      <p class="error" role="alert">This reset link is invalid or has expired.</p>
      <p class="swap">
        <RouterLink to="/forgot" data-testid="reset-to-forgot">Request a new one</RouterLink>
      </p>
    </div>
```

Also change the lede to render conditionally: `hasRecovery ? 'Choose a new password for your account.' : 'Reset links work once and expire after an hour.'`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/resetPasswordView.test.js`
Expected: PASS.

- [ ] **Step 5: Live smoke (mandatory, no LLM cost)**

From `/forgot`, request a reset email for the test account, open the emailed link, and confirm the password form renders (not the expired state). Then open `/reset-password` directly with no hash and confirm the expired state renders. Both must pass before commit; this task ships a lockout risk otherwise.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/ResetPasswordView.vue frontend/src/__tests__/resetPasswordView.test.js
git commit -m "fix(auth): reset-password shows expired-link state without a recovery session"
```

---

### Task 11: Explain "streak" and give the review page a way back (executor-sonnet)

**Files:**
- Modify: `frontend/src/views/ReviewView.vue:14-34` and page header
- Test: `frontend/src/__tests__/reviewView.test.js` (exists; it already mocks `@/services/reviewApi.js` via `apiReviewQueue` and defines `makeReviewItem(concept, overrides)`)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('ReviewView', ...)`, and add `BackButton: { template: '<a data-testid="back-button" />' }` to the file's `stubs` object (or to the `global.stubs` passed in its mount helper):

```js
  it('labels the streak in plain words and renders a back control', async () => {
    apiReviewQueue.mockResolvedValue({
      total: 1,
      items: [makeReviewItem('ATP yield', { streak: 2 })],
    })
    const w = mount(ReviewView, { global: { stubs } })
    await flushPromises()
    expect(w.get('[data-testid="review-item"]').text()).toContain('2 correct in a row')
    expect(w.text()).not.toMatch(/streak \d/)
    expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/reviewView.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Line 23 meta span:

```html
          <span class="review-meta">
            {{ item.source_topic }} &middot;
            {{ item.streak === 1 ? '1 correct in a row' : `${item.streak} correct in a row` }}
          </span>
```

Add `<BackButton label="Back" fallback="/" />` as the first child of the page section and import it. Add a one-line lede under the existing "Concepts due for a quick check.": `Each check that you get right extends the gap before the next one.`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/reviewView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ReviewView.vue frontend/src/__tests__/reviewView.test.js
git commit -m "fix(review): label streak in plain words and add back control"
```

---

### Task 12: Sidebar review badge announces its unit (executor-haiku)

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue:318-328`
- Test: `frontend/src/__tests__/sidebarA11y.test.js`

- [ ] **Step 1: Write the failing test**

Add to `sidebarA11y.test.js` (reuse its mount + `useSessionStore` seeding; set whatever drives `reviewTotal` to 20 the same way the existing sidebar tests do, search the file for `reviewTotal` or the review queue mock):

```js
  it('review link exposes the count with a unit', async () => {
    const w = await mountSidebarWithReview(20)
    const link = w.get('[data-testid="sidebar-review"]')
    expect(link.attributes('aria-label')).toBe('Review: 20 concepts due')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run src/__tests__/sidebarA11y.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

On the `RouterLink` at `Sidebar.vue:318` add:

```html
      :aria-label="`Review: ${reviewTotal} ${reviewTotal === 1 ? 'concept' : 'concepts'} due`"
```

and add `aria-hidden="true"` to the `.sb-review-count` span so the count is not read twice.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --run src/__tests__/sidebarA11y.test.js src/__tests__/sidebar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebarA11y.test.js
git commit -m "fix(a11y): sidebar review badge announces its unit"
```

---

### Task 13: Dismiss control on the level-pitch card meets the 24px target (executor-haiku)

**Files:**
- Modify: `frontend/src/components/DiagnosticConsentCard.vue` (`.diag-dismiss` rule and `:56` radius)
- Test: none (pure CSS). Verify with the browser check below.

- [ ] **Step 1: Implement**

```css
.diag-dismiss {
  min-width: 2rem;
  min-height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
}
```

Change the hardcoded `border-radius: 8px` at line 56 to `border-radius: var(--radius-md)` (confirm the token name in `base.css`; if only `--radius-card` and `--radius-pill` exist, use `--radius-card`).

- [ ] **Step 2: Verify**

Load `/session/1f17b2cb691748ec94304a873f2b7a90`; in devtools the dismiss button box is at least 32x32. Do not click any of the card's level buttons.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DiagnosticConsentCard.vue
git commit -m "fix(chat): dismiss control on level card meets touch target size"
```

---

### Task 14: Full verification and PR (executor-sonnet)

- [ ] **Step 1: Run the full frontend suite and lint**

From `frontend/`: `npm run test:unit -- --run` then `npm run lint`. Expected: all green, zero lint errors.

- [ ] **Step 2: Browser pass (read-only)**

Load in dark then light: `/`, `/sessions`, `/review`, `/settings/usage`, `/settings/profile`, `/settings/account`, `/session/db4c2a1b20814cada3a4541b8fa4d5f8`, `/tos`. Confirm each task's visual outcome. Do not send messages.

- [ ] **Step 3: Detector re-run**

From repo root: `"C:/Users/EDWARD/.claude/plugins/cache/impeccable/impeccable/4.3.1/skills/impeccable/scripts/impeccable" detect --json frontend/src`. Expected: no new rule ids versus the 2026-09-10 baseline (`overused-font`, `side-tab`, `layout-transition`, `bounce-easing`).

- [ ] **Step 4: Push and open PR to `dev`**

```bash
git push -u origin fix/frontend-critique-2026-09-10
gh pr create --base dev --title "fix: frontend critique remediation 2026-09-10" --body-file - <<'EOF'
Closes the actionable findings in docs/reviews/2026-09-10-frontend-critique.md.

Tasks 1 and 3-13 of docs/superpowers/plans/2026-09-10-frontend-critique-fixes.md (Task 2 withdrawn in favour of #288).

Verification: full vitest suite green, lint clean, read-only browser pass in dark and light, impeccable detect shows no new rule ids.

Tracked separately: #287 (doubled level question, backend prompt), #288 (mastered/gap reconciliation, backend aggregate).
EOF
```

- [ ] **Step 5: Re-run the critique after merge**

`/impeccable critique frontend/src` to record the new score against the 23/40 baseline.

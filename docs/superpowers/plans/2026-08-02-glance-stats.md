# Glance Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four sparse-data charts in the Settings surface (mastery trend, knowledge distribution bar, weakest-concepts widget, 14-day spend chart) with glance-level text lines; keep the usage cap meter.

**Architecture:** All replacement text derives from props/data the components already receive — zero API or contract changes. `ProfileTab.vue` gets three inline text lines replacing two child components and a segmented bar; `UsagePanel.vue` is simplified in place. `MasteryTrend.vue` and `WeakestConcepts.vue` are deleted with their tests.

**Tech Stack:** Vue 3 `<script setup>`, Vitest + @vue/test-utils. Frontend only.

**Spec:** `docs/superpowers/specs/2026-08-02-glance-stats-design.md`

## Global Constraints

- Branch: `feat/glance-stats` off `feat/unified-settings`. Separate PR stacked on #210 (retarget to `dev` if #210 merges first).
- No API or contract change. Data sources: `weekly_mastery`, `knowledge_level_distribution`, `concept_accuracy` (ProfileTab via `getAggregateProfile`); `daily`, `today_spend_usd`, `hard_cap_usd` (UsagePanel via `usage` prop).
- Testids that MUST keep resolving: `agg-dist` (distribution line), `usage-panel` (UsagePanel root).
- Copy exact forms (from spec, verbatim): `"3 mastered this week · 10 total"`, zero form `"Nothing mastered yet"` (only when mastered total is 0); `"8 beginner · 7 intermediate · 5 advanced · 15 unknown"` with zero-count levels omitted; `"Needs attention: formal analysis (31%), data transmission (33%), CSS selectors (67%)"` hidden entirely when no accuracy data; `"Today $0.03 · Last 7 days $0.14"`.
- The usage cap meter and its `"Today $X.XX / $Y.YY cap"` caption stay byte-identical. Top-sessions list unchanged.
- Fetch/error/empty states of ProfileTab and UsageTab untouched.
- Test commands run from `frontend/`: `npm run test:unit -- --run` (full), `npm run test:unit -- --run src/__tests__/profileTab.test.js` (single file). Lint: `npm run lint`.
- Native Grep for testid sweeps, never `rtk rg` (false-zero gotcha).
- No emojis in code or comments.

---

### Task 1: ProfileTab glance lines (mastery, distribution, needs-attention)

**Files:**
- Modify: `frontend/src/components/settings/ProfileTab.vue`
- Test: `frontend/src/__tests__/profileTab.test.js`

**Interfaces:**
- Consumes: existing `getAggregateProfile()` payload fields `weekly_mastery: [{week_start, count}]` (chronological, latest bucket last), `knowledge_level_distribution: {beginner, intermediate, advanced, unknown}`, `concept_accuracy: [{concept, accuracy, total_count, last_results, first_seen_session_id}]`, `combined_mastered_concepts`.
- Produces: three glance lines with testids `glance-mastery`, `agg-dist` (container, existing), `glance-attention`. Container `agg-insights` keeps its testid and now wraps the mastery + attention lines. Task 3 relies on `MasteryTrend`/`WeakestConcepts` no longer being imported anywhere after this task.

- [ ] **Step 0: Create branch**

```bash
git checkout feat/unified-settings
git pull
git checkout -b feat/glance-stats
```

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/profileTab.test.js`:

Extend `nonEmptyAggregatePayload()` — replace the current empty `concept_accuracy: []` and `weekly_mastery: []` lines with:

```js
    concept_accuracy: [
      { concept: 'formal analysis', accuracy: 0.31, total_count: 13, last_results: [false, false, true], first_seen_session_id: 's1' },
      { concept: 'data transmission', accuracy: 0.33, total_count: 3, last_results: [false, true], first_seen_session_id: 's1' },
      { concept: 'CSS selectors', accuracy: 0.67, total_count: 3, last_results: [true, true, false], first_seen_session_id: 's2' },
      { concept: 'fourth concept', accuracy: 0.9, total_count: 4, last_results: [true, true], first_seen_session_id: 's2' },
      { concept: 'single try', accuracy: 0, total_count: 1, last_results: [false], first_seen_session_id: 's3' },
    ],
    weekly_mastery: [
      { week_start: '2026-07-20', count: 1 },
      { week_start: '2026-07-27', count: 3 },
    ],
```

Replace the two child-component assertions in `'renders stats from getAggregateProfile fixture'` (lines asserting `weakest-concepts` and `mastery-trend` exist) with glance-line assertions:

```js
    expect(wrapper.find('[data-testid="glance-mastery"]').text()).toBe(
      '3 mastered this week · 2 total',
    )
    expect(wrapper.find('[data-testid="agg-dist"]').text()).toContain('2 beginner · 1 intermediate')
    expect(wrapper.find('[data-testid="agg-dist"]').text()).not.toContain('advanced')
    expect(wrapper.find('[data-testid="agg-dist"]').text()).not.toContain('unknown')
    const attention = wrapper.find('[data-testid="glance-attention"]').text()
    expect(attention).toBe(
      'Needs attention: formal analysis (31%), data transmission (33%), CSS selectors (67%)',
    )
    expect(attention).not.toContain('fourth concept')
    expect(attention).not.toContain('single try')
```

Note: `2 total` because the fixture has 2 `combined_mastered_concepts`; `single try` excluded because `total_count < 2`; `fourth concept` excluded by top-3 slice.

Add a new test after `'renders mastered + gap chips with counts'`:

```js
  it('glance lines: zero-mastered form and hidden needs-attention', async () => {
    seedUser()
    const payload = nonEmptyAggregatePayload()
    payload.combined_mastered_concepts = []
    payload.weekly_mastery = []
    payload.concept_accuracy = []
    vi.spyOn(profileApi, 'getAggregateProfile').mockResolvedValue(payload)

    const wrapper = mount(ProfileTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.find('[data-testid="glance-mastery"]').text()).toBe('Nothing mastered yet')
    expect(wrapper.find('[data-testid="glance-attention"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/profileTab.test.js`
Expected: FAIL — `glance-mastery` / `glance-attention` not found; `agg-dist` text mismatch.

- [ ] **Step 3: Implement in ProfileTab.vue**

Template — replace the `agg-dist` block (the `div.dist` containing `.dist-bar` and `.dist-legend`) with:

```html
        <div class="dist" data-testid="agg-dist">
          <h2 class="section-title">Knowledge level distribution</h2>
          <p v-if="distLine" class="glance-line">{{ distLine }}</p>
        </div>
```

Replace the `agg-insights` block (the `div.two-col` wrapping `WeakestConcepts` and `MasteryTrend`) with:

```html
        <div class="glance" data-testid="agg-insights">
          <p class="glance-line" data-testid="glance-mastery">{{ masteryLine }}</p>
          <p v-if="attentionLine" class="glance-line" data-testid="glance-attention">
            {{ attentionLine }}
          </p>
        </div>
```

Script — remove the imports of `MasteryTrend` and `WeakestConcepts`, remove the `distAriaLabel` computed, and add:

```js
const distLine = computed(() => {
  const d = data.value?.knowledge_level_distribution || {}
  return levelKeys
    .filter((k) => (d[k] || 0) > 0)
    .map((k) => `${d[k]} ${k}`)
    .join(' · ')
})

const masteryLine = computed(() => {
  const total = data.value?.combined_mastered_concepts.length || 0
  if (total === 0) return 'Nothing mastered yet'
  const weeks = data.value?.weekly_mastery || []
  const thisWeek = weeks.length ? weeks[weeks.length - 1].count : 0
  return `${thisWeek} mastered this week · ${total} total`
})

const attentionLine = computed(() => {
  const ranked = (data.value?.concept_accuracy || [])
    .filter((c) => c.total_count >= 2)
    .sort((a, b) => a.accuracy - b.accuracy || a.concept.localeCompare(b.concept))
    .slice(0, 3)
  if (!ranked.length) return ''
  const parts = ranked.map((c) => `${c.concept} (${Math.round(c.accuracy * 100)}%)`)
  return `Needs attention: ${parts.join(', ')}`
})
```

Styles — delete the now-unused rules `.dist-bar`, `.dist-seg`, `.seg-beginner`, `.seg-intermediate`, `.seg-advanced`, `.seg-unknown`, `.dist-legend`, `.dist-legend li`, `.dist-key`, `.dist-count`, `.dot`. Keep `.dist`, `.section-title`, `.two-col` (still used by mastered/gaps columns). Add:

```css
.glance {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.glance-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  color: var(--color-text-muted);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/profileTab.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/ProfileTab.vue frontend/src/__tests__/profileTab.test.js
git commit -m "feat(settings): replace ProfileTab charts with glance text lines"
```

---

### Task 2: UsagePanel — drop spend chart, add today/7-day glance line

**Files:**
- Modify: `frontend/src/components/profile/UsagePanel.vue`
- Test: `frontend/src/__tests__/usagePanel.test.js`

**Interfaces:**
- Consumes: existing `usage` prop fields `daily: [{date_utc, cost_usd}]` (chronological, today last), `today_spend_usd`, `soft_cap_usd`, `urgent_cap_usd`, `hard_cap_usd`, `top_sessions`.
- Produces: glance line with testid `usage-glance` above the meter. Root keeps `data-testid="usage-panel"`. Cap meter markup/behavior unchanged.

- [ ] **Step 1: Update tests**

In `frontend/src/__tests__/usagePanel.test.js`:

Delete the test `'renders one spend bar per day, scaled to the max day'` entirely.

Add in its place:

```js
  it('renders the today / last-7-days glance line and no bar chart', () => {
    const w = factory()
    expect(w.find('[data-testid="usage-glance"]').text()).toBe('Today $1.00 · Last 7 days $1.50')
    expect(w.find('.spend-chart').exists()).toBe(false)
  })

  it('sums only the last 7 daily entries', () => {
    const w = factory(
      usage({
        daily: [
          { date_utc: '2026-07-03', cost_usd: 5.0 },
          { date_utc: '2026-07-04', cost_usd: 0.1 },
          { date_utc: '2026-07-05', cost_usd: 0.1 },
          { date_utc: '2026-07-06', cost_usd: 0.1 },
          { date_utc: '2026-07-07', cost_usd: 0.1 },
          { date_utc: '2026-07-08', cost_usd: 0.1 },
          { date_utc: '2026-07-09', cost_usd: 0.1 },
          { date_utc: '2026-07-10', cost_usd: 0.1 },
        ],
        today_spend_usd: 0.1,
      }),
    )
    expect(w.find('[data-testid="usage-glance"]').text()).toBe('Today $0.10 · Last 7 days $0.70')
  })
```

In the `'shows empty state when there is no spend at all'` test, keep the `usage-empty` assertion and replace the `.spend-chart` assertion with:

```js
    expect(w.find('[data-testid="usage-glance"]').exists()).toBe(false)
```

Leave the tier-marker, meter-fill, and top-sessions tests untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/usagePanel.test.js`
Expected: FAIL — `usage-glance` not found; `.spend-chart` still exists.

- [ ] **Step 3: Implement in UsagePanel.vue**

Template — delete the whole `div.spend-chart` block. Immediately inside the `<template v-else>` (above `div.meter-wrap`), add:

```html
      <p class="glance-line" data-testid="usage-glance">
        Today ${{ usage.today_spend_usd.toFixed(2) }} · Last 7 days ${{ last7.toFixed(2) }}
      </p>
```

Leave `div.meter-wrap`, the meter caption, `usage-empty`, and top-sessions markup byte-identical.

Script — delete the `barHeight` function; `maxDay` and `noSpend` stay (empty-state logic unchanged). Add:

```js
const last7 = computed(() =>
  props.usage.daily.slice(-7).reduce((acc, d) => acc + d.cost_usd, 0),
)
```

Styles — delete `.spend-chart`, `.spend-col`, `.spend-track`, `.spend-bar` rules. Add:

```css
.glance-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  color: var(--color-text-muted);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/usagePanel.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/profile/UsagePanel.vue frontend/src/__tests__/usagePanel.test.js
git commit -m "feat(settings): replace usage spend chart with today/7-day glance line"
```

---

### Task 3: Delete dead components, testid sweep, full verification

**Files:**
- Delete: `frontend/src/components/profile/MasteryTrend.vue`
- Delete: `frontend/src/components/profile/WeakestConcepts.vue`
- Delete: `frontend/src/__tests__/masteryTrend.test.js`
- Delete: `frontend/src/__tests__/weakestConcepts.test.js`

**Interfaces:**
- Consumes: Task 1 removed the only component imports of `MasteryTrend`/`WeakestConcepts` (in `ProfileTab.vue`).
- Produces: repo with zero references to `MasteryTrend`, `WeakestConcepts`, `mastery-trend`, `weakest-concepts`.

- [ ] **Step 1: Verify no remaining references, then delete**

Sweep with NATIVE grep tooling (not rtk rg — known false-zero):

```bash
grep -rn -E "MasteryTrend|WeakestConcepts|mastery-trend|weakest-concepts" frontend/src frontend/e2e
```

Expected hits ONLY in the four files about to be deleted. If any other file matches, STOP and report — do not delete.

```bash
git rm frontend/src/components/profile/MasteryTrend.vue frontend/src/components/profile/WeakestConcepts.vue frontend/src/__tests__/masteryTrend.test.js frontend/src/__tests__/weakestConcepts.test.js
```

- [ ] **Step 2: Re-run sweep to confirm zero references**

```bash
grep -rn -E "MasteryTrend|WeakestConcepts|mastery-trend|weakest-concepts" frontend/src frontend/e2e
```

Expected: no matches (grep exits 1).

- [ ] **Step 3: Full suite + lint**

Run from `frontend/`:

```bash
npm run test:unit -- --run
npm run lint
```

Expected: all tests pass, lint clean. Any failure → STOP and report.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(settings): delete MasteryTrend and WeakestConcepts components"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/glance-stats
gh pr create --base feat/unified-settings --title "feat(settings): glance stats — replace charts with text summaries" --body "Implements docs/superpowers/specs/2026-08-02-glance-stats-design.md. Stacked on #210; retarget to dev if #210 merges first."
```

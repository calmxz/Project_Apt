# Unified Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Profile and Settings pages with one claude.ai-style Settings surface (`/settings/:tab`) with four tabs: Profile, Usage, Account, Appearance.

**Architecture:** `SettingsView.vue` becomes a thin shell (title + tab rail + active tab component). Each tab is a new component under `frontend/src/components/settings/`. Content moves verbatim from `SettingsView.vue` cards and `AggregateProfileView.vue`; `AggregateProfileView.vue` is deleted at the end. Router gains `/settings/:tab` with redirects from `/settings` and `/profile`. Frontend-only; zero backend/API change.

**Tech Stack:** Vue 3 `<script setup>`, vue-router 4, vitest + @vue/test-utils. All tests run from `frontend/`: `npx vitest run <file>`; full suite `npm run test:unit -- --run`; lint `npm run lint`.

**Spec:** `docs/superpowers/specs/2026-08-02-unified-settings-design.md`

## Global Constraints

- No emojis in code or comments.
- No backend or contract changes (`docs/api/openapi.yaml` untouched).
- Preserve every existing `data-testid` that survives the move (list per task); grep both `frontend/src/__tests__/` AND `frontend/e2e/` for removed testids — they are separate suites.
- Tab slugs exactly: `profile`, `usage`, `account`, `appearance`. Invalid slug redirects to `profile`.
- Route names preserved: `settings`, `profile-aggregate` (becomes redirect), `session-profile` untouched.
- Tab switching uses router `push` (browser back walks tab history).
- Work on branch `feat/unified-settings` off `dev` (create in Task 1, Step 0).

---

### Task 1: Router — `/settings/:tab` + redirects

**Files:**
- Modify: `frontend/src/router/index.js:61-70`
- Test: `frontend/src/__tests__/settingsRouting.test.js` (create)

**Interfaces:**
- Produces: route `settings` at path `/settings/:tab`, prop `tab` passed to `SettingsView`; redirects `/settings` -> `/settings/profile`, `/profile` (name `profile-aggregate`) -> `/settings/profile`, invalid tab -> `/settings/profile`.
- Consumes: nothing. NOTE: until Task 6, `SettingsView.vue` ignores the `tab` prop — that is fine; this task only pins routing behavior.

- [ ] **Step 0: Branch**

```bash
git checkout dev && git pull && git checkout -b feat/unified-settings
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/settingsRouting.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router from '../router/index.js'
import { useAuthStore } from '../stores/auth.js'
import { useUserStore } from '../stores/user.js'

// Route-level redirect tests. Auth/onboarding guards are made green so only
// the redirect logic under test decides the destination.
beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.ready = true
  auth.isAuthenticated = true
  const user = useUserStore()
  user.hydrated = true
  user.onboardingComplete = true
})

describe('unified settings routing', () => {
  it('/settings redirects to /settings/profile', async () => {
    await router.push('/settings')
    expect(router.currentRoute.value.fullPath).toBe('/settings/profile')
  })

  it('/profile redirects to /settings/profile and keeps its route name usable', async () => {
    await router.push({ name: 'profile-aggregate' })
    expect(router.currentRoute.value.fullPath).toBe('/settings/profile')
  })

  it('invalid tab slug redirects to /settings/profile', async () => {
    await router.push('/settings/bogus')
    expect(router.currentRoute.value.fullPath).toBe('/settings/profile')
  })

  it('each valid tab resolves to the settings route with the tab param', async () => {
    for (const tab of ['profile', 'usage', 'account', 'appearance']) {
      await router.push(`/settings/${tab}`)
      expect(router.currentRoute.value.name).toBe('settings')
      expect(router.currentRoute.value.params.tab).toBe(tab)
    }
  })
})
```

If the auth/user stores reject direct field assignment (getters only), mirror how `frontend/src/__tests__/router.test.js` fakes an authenticated session and reuse that pattern instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/settingsRouting.test.js`
Expected: FAIL — `/settings` resolves to itself (no redirect), `/settings/bogus` is a 404 catch or stays put.

- [ ] **Step 3: Implement routing**

In `frontend/src/router/index.js` replace the two route records (currently lines 61-70):

```js
    {
      path: '/settings',
      redirect: { name: 'settings', params: { tab: 'profile' } },
    },
    {
      path: '/settings/:tab',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      props: true,
      beforeEnter: (to) => {
        const valid = ['profile', 'usage', 'account', 'appearance']
        if (!valid.includes(to.params.tab)) {
          return { name: 'settings', params: { tab: 'profile' } }
        }
      },
    },
    {
      // Unified into Settings (2026-08-02): aggregate profile is now the
      // Profile tab. Redirect kept so old links and router.push({name})
      // calls keep working.
      path: '/profile',
      name: 'profile-aggregate',
      redirect: { name: 'settings', params: { tab: 'profile' } },
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/settingsRouting.test.js src/__tests__/router.test.js`
Expected: all PASS (router.test.js guards unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/router/index.js frontend/src/__tests__/settingsRouting.test.js
git commit -m "feat(settings): route /settings/:tab with profile default and /profile redirect"
```

---

### Task 2: AppearanceTab component

**Files:**
- Create: `frontend/src/components/settings/AppearanceTab.vue`
- Test: `frontend/src/__tests__/appearanceTab.test.js` (create)

**Interfaces:**
- Produces: `AppearanceTab.vue` — no props, no emits; renders the dark-mode switch card. Keeps testids `settings-appearance`, `settings-theme-toggle`.
- Consumes: `useTheme()` from `frontend/src/composables/useTheme.js` (`{ isDark, toggle }`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/appearanceTab.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const toggle = vi.fn()
vi.mock('../composables/useTheme.js', () => ({
  useTheme: () => ({ isDark: { value: false }, toggle }),
}))

import AppearanceTab from '../components/settings/AppearanceTab.vue'

describe('AppearanceTab', () => {
  it('renders the dark mode switch with its testids', () => {
    const w = mount(AppearanceTab)
    expect(w.find('[data-testid="settings-appearance"]').exists()).toBe(true)
    expect(w.find('[data-testid="settings-theme-toggle"]').exists()).toBe(true)
  })

  it('clicking the switch calls theme toggle', async () => {
    const w = mount(AppearanceTab)
    await w.find('[data-testid="settings-theme-toggle"]').trigger('click')
    expect(toggle).toHaveBeenCalled()
  })
})
```

If `frontend/src/__tests__/settingsView.test.js` already mocks `useTheme` differently (check it first), copy its mock shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/appearanceTab.test.js`
Expected: FAIL — module `../components/settings/AppearanceTab.vue` not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/settings/AppearanceTab.vue`. Move the Appearance card verbatim from `SettingsView.vue` (template lines 59-82: the `<section class="card" data-testid="settings-appearance">` block) plus the `useTheme` wiring and the card/switch CSS (`.card`, `.card-title`, `.card-icon`, `.switch-row`, `.switch-body`, `.switch-label`, `.switch-sub`, `.switch`, `.switch--on`, `.switch:focus-visible`, `.switch-knob`, `.switch--on .switch-knob` rules from SettingsView's style block):

```vue
<template>
  <section class="card" data-testid="settings-appearance">
    <h2 class="card-title">
      <i class="pi pi-moon card-icon" aria-hidden="true" />
      Appearance
    </h2>
    <div class="switch-row">
      <span class="switch-body">
        <span class="switch-label">Dark mode</span>
        <span class="switch-sub">Use a dark theme across the app.</span>
      </span>
      <button
        type="button"
        class="switch"
        :class="{ 'switch--on': isDark }"
        role="switch"
        :aria-checked="isDark"
        aria-label="Dark mode"
        data-testid="settings-theme-toggle"
        @click="toggleTheme"
      >
        <span class="switch-knob" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<script setup>
import { useTheme } from '../../composables/useTheme.js'

const { isDark, toggle: toggleTheme } = useTheme()
</script>

<style scoped>
/* copy .card, .card-title, .card-icon and all .switch* rules verbatim from
   SettingsView.vue style block (lines 335-361 and 516-584) */
</style>
```

Do NOT remove anything from `SettingsView.vue` yet — the shell swap happens in Task 6. Duplicated card CSS across tab components is accepted; a shared stylesheet is out of scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/appearanceTab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/AppearanceTab.vue frontend/src/__tests__/appearanceTab.test.js
git commit -m "feat(settings): extract AppearanceTab component"
```

---

### Task 3: AccountTab component

**Files:**
- Create: `frontend/src/components/settings/AccountTab.vue`
- Test: `frontend/src/__tests__/accountTab.test.js` (create)
- Reference (read only): `frontend/src/views/SettingsView.vue`, `frontend/src/__tests__/settingsView.test.js`

**Interfaces:**
- Produces: `AccountTab.vue` — no props, no emits. Contains: display-name form (save via `user.updateProfile`), change-password form, sign-out button, danger zone. Keeps testids `settings-name`, `settings-save`, `settings-saved`, `settings-error`, `settings-security`, `settings-pw-current`, `settings-pw-new`, `settings-pw-confirm`, `settings-pw-mismatch`, `settings-pw-error`, `settings-pw-success`, `settings-pw-submit`, `settings-signout-section`, `settings-sign-out`, `settings-danger`, `settings-retake-onboarding`.
- Consumes: `useUserStore` (`user.name`, `user.interactionPreferences`, `user.updateProfile({ name, feedback })`), `useAuthStore` (`isAuthenticated`, `userEmail`, `signIn`, `updatePassword`, `signOut`), `useToast`, `friendlyError`.
- IMPORTANT split detail: today `save()` submits name AND feedback together. Feedback moves to ProfileTab (Task 5). AccountTab's save must send the name plus the CURRENT stored feedback so the API payload stays complete: `user.updateProfile({ name: displayName.value, feedback: user.interactionPreferences?.feedback || 'hints' })`. `dirty` compares only the name.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/accountTab.test.js`. Port the account/password/signout cases from `settingsView.test.js` (read it first; reuse its store mocks verbatim), targeting the new component. Minimum cases:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// Reuse the exact store/toast mock setup from settingsView.test.js here.
import AccountTab from '../components/settings/AccountTab.vue'

describe('AccountTab', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders name field, security card, signout and danger zone testids', () => {
    const w = mount(AccountTab)
    for (const id of [
      'settings-name', 'settings-save', 'settings-security',
      'settings-signout-section', 'settings-danger', 'settings-retake-onboarding',
    ]) {
      expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(true)
    }
  })

  it('save button disabled until name changes (feedback no longer affects dirty)', async () => {
    const w = mount(AccountTab)
    expect(w.find('[data-testid="settings-save"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="settings-name"]').setValue('New Name')
    expect(w.find('[data-testid="settings-save"]').attributes('disabled')).toBeUndefined()
  })

  it('save sends name plus current stored feedback', async () => {
    const w = mount(AccountTab)
    await w.find('[data-testid="settings-name"]').setValue('New Name')
    await w.find('form').trigger('submit')
    // assert against the mocked updateProfile:
    // expect(updateProfile).toHaveBeenCalledWith({ name: 'New Name', feedback: 'hints' })
  })

  it('password mismatch hint shows when confirm differs', async () => {
    const w = mount(AccountTab)
    await w.find('[data-testid="settings-pw-new"]').setValue('longenough1')
    await w.find('[data-testid="settings-pw-confirm"]').setValue('different1')
    expect(w.find('[data-testid="settings-pw-mismatch"]').exists()).toBe(true)
  })
})
```

Flesh out the mocked `updateProfile` assertion to match the mock style used in `settingsView.test.js` (it already mounts SettingsView with pinia store mocks — copy that scaffolding).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/accountTab.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/settings/AccountTab.vue`:

- Template: Account card (SettingsView.vue template lines 10-28), the save `actions` block + `settings-error` paragraph (lines 38-56) wrapped in the same `<form @submit.prevent="save">`, Security card (lines 84-145), sign-out section (lines 147-156), danger zone (lines 158-174) — all verbatim, minus the Feedback style card.
- Script: copy from SettingsView.vue script the imports (`FeedbackStylePicker` import NOT needed), stores, `displayName`, `savedFlash`, `saving`, `saveError`, the password refs/computeds/`changePassword`, `signOut`. Replace `dirty` and `save`:

```js
const dirty = computed(() => (displayName.value || '').trim() !== (user.name || ''))

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  saveError.value = null
  try {
    await user.updateProfile({
      name: displayName.value,
      feedback: user.interactionPreferences?.feedback || 'hints',
    })
    savedFlash.value = true
    showSuccess('Preferences saved.')
  } catch (e) {
    saveError.value = friendlyError(e)
  } finally {
    saving.value = false
  }
}

watch(displayName, () => {
  savedFlash.value = false
})
```

- Style: copy the rules these blocks use from SettingsView.vue style block: `.card`, `.card-title`, `.card-icon`, `.field`, `.lbl`, `.input` (+ placeholder/focus), `.hint`, `.actions`, `.save-btn` (+ states), `.error`, `.saved-flash`, `.danger*`, `.signout*`, `.pw-form`, `.pw-error`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/accountTab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/AccountTab.vue frontend/src/__tests__/accountTab.test.js
git commit -m "feat(settings): extract AccountTab (name, password, signout, danger zone)"
```

---

### Task 4: UsageTab component

**Files:**
- Create: `frontend/src/components/settings/UsageTab.vue`
- Test: `frontend/src/__tests__/usageTab.test.js` (create)
- Reference (read only): `frontend/src/views/AggregateProfileView.vue:199-215`, `frontend/src/__tests__/usagePanel.test.js`

**Interfaces:**
- Produces: `UsageTab.vue` — no props, no emits. Fetches `getUsageSummary()` on mount, renders `UsagePanel` on success, keeps testid `usage-error` for the failure paragraph; adds a loading state testid `usage-tab-loading`.
- Consumes: `getUsageSummary` from `frontend/src/services/profileApi.js`; `UsagePanel.vue` (prop `usage`, object).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/usageTab.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const getUsageSummary = vi.fn()
vi.mock('../services/profileApi.js', () => ({
  getUsageSummary: (...a) => getUsageSummary(...a),
}))

import UsageTab from '../components/settings/UsageTab.vue'

const usageFixture = {
  daily: [{ date_utc: '2026-08-01', cost_usd: 0.05 }],
  today_spend_usd: 0.03,
  hard_cap_usd: 0.3,
  soft_cap_usd: 0.15,
  urgent_cap_usd: 0.25,
  top_sessions: [],
}

describe('UsageTab', () => {
  it('fetches usage on mount and renders the panel', async () => {
    getUsageSummary.mockResolvedValue(usageFixture)
    const w = mount(UsageTab)
    expect(w.find('[data-testid="usage-tab-loading"]').exists()).toBe(true)
    await flushPromises()
    expect(getUsageSummary).toHaveBeenCalledOnce()
    expect(w.find('[data-testid="usage-panel"]').exists()).toBe(true)
  })

  it('shows the error line when the fetch fails', async () => {
    getUsageSummary.mockRejectedValue(new Error('boom'))
    const w = mount(UsageTab)
    await flushPromises()
    expect(w.find('[data-testid="usage-error"]').exists()).toBe(true)
    expect(w.text()).toContain('Usage data is unavailable right now.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/usageTab.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/settings/UsageTab.vue`:

```vue
<template>
  <div class="usage-tab">
    <div v-if="loading" class="skel" data-testid="usage-tab-loading" aria-hidden="true">
      <span class="skel-block skel-row-tall" />
      <span class="skel-block skel-short" />
    </div>
    <span v-if="loading" class="sr-only" role="status">Loading</span>
    <UsagePanel v-else-if="usage" :usage="usage" />
    <p v-else class="muted" data-testid="usage-error">Usage data is unavailable right now.</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

import UsagePanel from '../profile/UsagePanel.vue'
import { getUsageSummary } from '../../services/profileApi.js'

const usage = ref(null)
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    usage.value = await getUsageSummary()
  } catch {
    usage.value = null
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.muted {
  color: var(--color-text-muted);
}

/* copy .skel, .skel-block, .skel-row-tall, .skel-short, @keyframes skel-pulse,
   .sr-only verbatim from AggregateProfileView.vue (lines 638-679) */
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/usageTab.test.js src/__tests__/usagePanel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/UsageTab.vue frontend/src/__tests__/usageTab.test.js
git commit -m "feat(settings): add UsageTab with lazy usage fetch"
```

---

### Task 5: ProfileTab component (aggregate profile + feedback style)

**Files:**
- Create: `frontend/src/components/settings/ProfileTab.vue`
- Test: `frontend/src/__tests__/profileTab.test.js` (create)
- Reference (read only): `frontend/src/views/AggregateProfileView.vue`, `frontend/src/__tests__/aggregateProfileView.test.js`, `frontend/src/__tests__/settingsView.test.js` (feedback cases)

**Interfaces:**
- Produces: `ProfileTab.vue` — no props, no emits. Aggregate learning profile (stats, distribution, insights, mastered/gaps chips, recent topics) + a Feedback style card with its own save button. Keeps testids from AggregateProfileView: `agg-profile` (move onto the tab root), `agg-loading`, `agg-error`, `agg-empty`, `agg-stats`, `agg-dist`, `agg-insights`, `agg-mastered`, `agg-gaps`, `agg-recent`. Adds `profile-feedback-save`.
- Consumes: `getAggregateProfile` from `profileApi.js`; `EmptyState`, `MasteryTrend`, `WeakestConcepts` components; `formatRelative`; `FeedbackStylePicker` (v-model + `options`); `useUserStore.updateProfile({ name, feedback })`; `useToast`.
- Usage is NOT fetched here (moved to UsageTab); `UsagePanel` import and `getUsageSummary` call are dropped.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/profileTab.test.js`. Port the assertions from `aggregateProfileView.test.js` (read it; reuse its fixtures and mocks — same `getAggregateProfile` mock shape) and add feedback cases:

```js
// Core cases to cover (port fixtures/mocks from aggregateProfileView.test.js):
// 1. loading skeleton shows, then stats render from getAggregateProfile fixture
// 2. error path renders [data-testid="agg-error"]
// 3. total_sessions === 0 renders [data-testid="agg-empty"]
// 4. mastered + gap chips render with counts
// 5. NEW: feedback style card renders FeedbackStylePicker and
//    [data-testid="profile-feedback-save"]; changing feedback enables save;
//    submitting calls user.updateProfile({ name: <current name>, feedback: 'direct_answers' })
// 6. NEW: getUsageSummary is NOT called (usage moved to its own tab)
```

Write these as real `it()` blocks with the ported fixture data — the fixture in `aggregateProfileView.test.js` already has `combined_mastered_concepts`, `combined_confirmed_gaps`, `knowledge_level_distribution`, `concept_accuracy`, `weekly_mastery`, `recent_topics`; copy it wholesale.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/profileTab.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/settings/ProfileTab.vue`:

- Template: everything inside AggregateProfileView.vue's root `<section>` EXCEPT the `<header class="head">` (the shell owns the page title now — keep a short lede line instead), and EXCEPT the `UsagePanel`/`usage-error` block (lines 165-168). Root element: `<div class="profile-tab" data-testid="agg-profile">`. Fix the empty-state CTA link: `to="/new"` stays (redirects to home).
- Append a Feedback style card after the recent-topics block:

```vue
    <section class="card" data-testid="profile-feedback">
      <h2 class="card-title">
        <i class="pi pi-comments card-icon" aria-hidden="true" />
        Feedback style
      </h2>
      <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
      <div class="actions">
        <button
          type="button"
          class="save-btn"
          data-testid="profile-feedback-save"
          :disabled="!feedbackDirty || savingFeedback"
          @click="saveFeedback"
        >
          <i class="pi pi-check" aria-hidden="true" />
          <span>Save feedback style</span>
        </button>
      </div>
    </section>
```

- Script: copy AggregateProfileView.vue script, dropping `UsagePanel` import, `usage`/`usageError` refs and the `getUsageSummary` half of `load()` (plain `try { data.value = await getAggregateProfile() } catch (e) { error.value = friendlyError(e) }`), and add:

```js
import FeedbackStylePicker from '../FeedbackStylePicker.vue'
import { useUserStore } from '../../stores/user.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const { showSuccess, showError } = useToast()

const feedbackOptions = [
  { value: 'hints', label: 'Hints', sub: 'Nudge me toward the answer.' },
  { value: 'direct_answers', label: 'Direct answers', sub: 'Explain outright when I ask.' },
]

const feedback = ref(user.interactionPreferences?.feedback || 'hints')
const savingFeedback = ref(false)
const feedbackDirty = computed(
  () => feedback.value !== (user.interactionPreferences?.feedback || 'hints'),
)

async function saveFeedback() {
  if (!feedbackDirty.value || savingFeedback.value) return
  savingFeedback.value = true
  try {
    await user.updateProfile({ name: user.name || '', feedback: feedback.value })
    showSuccess('Preferences saved.')
  } catch (e) {
    showError(e?.message || 'Could not save. Try again.')
  } finally {
    savingFeedback.value = false
  }
}
```

- Style: copy AggregateProfileView.vue's style block minus `.head`/`.head-text`/`.title`/`.folio` (shell owns those) plus the `.card`, `.card-title`, `.card-icon`, `.actions`, `.save-btn` rules from SettingsView.vue for the feedback card.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/profileTab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/ProfileTab.vue frontend/src/__tests__/profileTab.test.js
git commit -m "feat(settings): add ProfileTab (aggregate learning profile + feedback style)"
```

---

### Task 6: SettingsView shell with tab rail

**Files:**
- Rewrite: `frontend/src/views/SettingsView.vue`
- Modify: `frontend/src/__tests__/settingsView.test.js` (rewrite to shell tests)

**Interfaces:**
- Consumes: prop `tab` (string, from router `props: true`); the four tab components from Tasks 2-5.
- Produces: shell page. Testids: `settings` (root, kept), `settings-tab-rail`, `settings-tab-<slug>` per rail button. Tab switch = `router.push({ name: 'settings', params: { tab } })`.

- [ ] **Step 1: Rewrite the test file (failing first)**

Replace `frontend/src/__tests__/settingsView.test.js` content with shell tests. Old per-card cases are now covered by `accountTab.test.js` / `appearanceTab.test.js` / `profileTab.test.js` — verify each old case has a new home before deleting it (list them in the commit message if any are intentionally dropped). Shell tests (stub the four tab components; use a real router from `createRouter(createMemoryHistory())` with a minimal `/settings/:tab` route to avoid auth guards):

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import SettingsView from '../views/SettingsView.vue'

const stubs = {
  ProfileTab: { template: '<div data-testid="stub-profile" />' },
  UsageTab: { template: '<div data-testid="stub-usage" />' },
  AccountTab: { template: '<div data-testid="stub-account" />' },
  AppearanceTab: { template: '<div data-testid="stub-appearance" />' },
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings/:tab', name: 'settings', component: SettingsView, props: true }],
  })
}

async function mountAt(tab) {
  const router = makeRouter()
  await router.push(`/settings/${tab}`)
  const w = mount(SettingsView, {
    props: { tab },
    global: { plugins: [router], stubs },
  })
  return { w, router }
}

describe('SettingsView shell', () => {
  it('renders four rail tabs with testids', async () => {
    const { w } = await mountAt('profile')
    for (const slug of ['profile', 'usage', 'account', 'appearance']) {
      expect(w.find(`[data-testid="settings-tab-${slug}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="settings-tab-rail"]').attributes('role')).toBe('tablist')
  })

  it('active tab follows the tab prop', async () => {
    const { w } = await mountAt('usage')
    expect(w.find('[data-testid="stub-usage"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-profile"]').exists()).toBe(false)
    expect(w.find('[data-testid="settings-tab-usage"]').attributes('aria-selected')).toBe('true')
  })

  it('clicking a rail tab pushes the route', async () => {
    const { w, router } = await mountAt('profile')
    await w.find('[data-testid="settings-tab-account"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('account')
  })

  it('arrow key moves selection to the next tab (a11y)', async () => {
    const { w, router } = await mountAt('profile')
    await w.find('[data-testid="settings-tab-profile"]').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('usage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/settingsView.test.js`
Expected: FAIL — current SettingsView has no rail testids.

- [ ] **Step 3: Rewrite SettingsView.vue**

```vue
<template>
  <section class="settings" data-testid="settings">
    <header class="head">
      <span class="folio">preferences</span>
      <h1 class="title">Settings</h1>
    </header>

    <div class="layout">
      <nav
        class="rail"
        role="tablist"
        aria-label="Settings sections"
        data-testid="settings-tab-rail"
      >
        <button
          v-for="(t, i) in tabs"
          :key="t.slug"
          role="tab"
          :aria-selected="t.slug === tab ? 'true' : 'false'"
          :tabindex="t.slug === tab ? 0 : -1"
          :class="['rail-tab', { 'rail-tab--active': t.slug === tab }]"
          :data-testid="`settings-tab-${t.slug}`"
          type="button"
          @click="go(t.slug)"
          @keydown="onKeydown($event, i)"
        >
          <i :class="['pi', t.icon]" aria-hidden="true" />
          <span>{{ t.label }}</span>
        </button>
      </nav>

      <div class="panel" role="tabpanel">
        <KeepAlive>
          <component :is="activeComponent" />
        </KeepAlive>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import ProfileTab from '../components/settings/ProfileTab.vue'
import UsageTab from '../components/settings/UsageTab.vue'
import AccountTab from '../components/settings/AccountTab.vue'
import AppearanceTab from '../components/settings/AppearanceTab.vue'

const props = defineProps({
  tab: { type: String, default: 'profile' },
})

const router = useRouter()

const tabs = [
  { slug: 'profile', label: 'Profile', icon: 'pi-user', component: ProfileTab },
  { slug: 'usage', label: 'Usage', icon: 'pi-wallet', component: UsageTab },
  { slug: 'account', label: 'Account', icon: 'pi-lock', component: AccountTab },
  { slug: 'appearance', label: 'Appearance', icon: 'pi-moon', component: AppearanceTab },
]

const activeComponent = computed(
  () => (tabs.find((t) => t.slug === props.tab) || tabs[0]).component,
)

function go(slug) {
  if (slug === props.tab) return
  router.push({ name: 'settings', params: { tab: slug } })
}

function onKeydown(e, i) {
  let next = null
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length]
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
    next = tabs[(i - 1 + tabs.length) % tabs.length]
  if (!next) return
  e.preventDefault()
  go(next.slug)
}
</script>

<style scoped>
.settings {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* keep .head, .folio, .title, .lede rules from the old SettingsView */

.layout {
  display: grid;
  grid-template-columns: 12rem 1fr;
  gap: 2rem;
  align-items: start;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  position: sticky;
  top: 1rem;
}

.rail-tab {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease;
}

.rail-tab:hover {
  background: var(--color-surface-soft);
  color: var(--color-heading);
}

.rail-tab--active {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
}

.rail-tab:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@media (max-width: 48rem) {
  .layout {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .rail {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }

  .rail-tab {
    flex-shrink: 0;
  }
}
</style>
```

Note the old page-level `.lede` copy ("Tune how the tutor addresses you...") is dropped — it described only the old preferences form.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/settingsView.test.js src/__tests__/settingsRouting.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SettingsView.vue frontend/src/__tests__/settingsView.test.js
git commit -m "feat(settings): tab-rail shell hosting profile, usage, account, appearance tabs"
```

---

### Task 7: Sidebar cleanup, delete AggregateProfileView, sweep + full suite

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue:510-535`
- Delete: `frontend/src/views/AggregateProfileView.vue`, `frontend/src/__tests__/aggregateProfileView.test.js`
- Modify: `frontend/src/__tests__/sidebar.test.js` (Profile-entry cases)

**Interfaces:**
- Consumes: routes from Task 1 (Profile content lives at `/settings/profile`).
- Produces: sidebar footer with a single Settings entry.

- [ ] **Step 1: Failing test — sidebar has no Profile entry**

In `frontend/src/__tests__/sidebar.test.js`, find every case referencing `sidebar-profile` (grep the file). Replace with an absence assertion in the footer describe block:

```js
it('footer has a single Settings entry and no Profile entry', () => {
  // reuse the existing sidebar mount helper in this file
  expect(wrapper.find('[data-testid="sidebar-profile"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="sidebar-settings"]').exists()).toBe(true)
})
```

Run: `npx vitest run src/__tests__/sidebar.test.js` — new case FAILS (entry still present).

- [ ] **Step 2: Remove the Profile RouterLink**

Delete the `RouterLink` block at `Sidebar.vue` lines 511-522 (the `to="/profile"` entry). Keep the Settings link unchanged.

- [ ] **Step 3: Delete the old view and its test**

```bash
git rm frontend/src/views/AggregateProfileView.vue frontend/src/__tests__/aggregateProfileView.test.js
```

- [ ] **Step 4: Testid + reference sweep**

Use native grep (NOT rtk rg — known false-zero gotcha):

```bash
grep -rn "AggregateProfileView" frontend/src frontend/e2e
grep -rn "sidebar-profile" frontend/src frontend/e2e
grep -rn "profile-aggregate" frontend/src frontend/e2e
grep -rn "agg-profile\|agg-stats\|agg-mastered\|agg-gaps\|agg-recent\|agg-dist\|agg-insights\|agg-empty\|agg-error\|agg-loading" frontend/e2e
```

Expected: zero hits for `AggregateProfileView` and `sidebar-profile` outside this plan's files; `profile-aggregate` only in `router/index.js`; `agg-*` testids in e2e specs still resolve because ProfileTab keeps them — any e2e spec that NAVIGATES to `/profile` still works via the redirect. Fix any stragglers found (update paths/testids, do not delete specs).

- [ ] **Step 5: Full suite + lint**

```bash
npm run test:unit -- --run
npm run lint
```

Expected: all pass, lint clean. Fix anything red before committing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): remove sidebar Profile entry and delete AggregateProfileView"
```

---

### Task 8: Browser smoke + PR

**Files:** none (verification only)

- [ ] **Step 1: Live smoke (dev servers: `uvicorn main:app --reload` from backend/, `npm run dev` from frontend/)**

Check in Chrome at `http://localhost:5173`:
1. Sidebar footer shows only Settings; clicking lands on `/settings/profile` with rail.
2. All four tabs switch, URL updates, browser back walks tab history.
3. `/profile` typed in the address bar redirects to `/settings/profile`.
4. Profile tab shows stats/chips + feedback card; save feedback works (toast).
5. Usage tab shows spend chart + cap meter.
6. Account tab: name save, password mismatch hint, danger zone visible.
7. Appearance tab: dark-mode toggle flips theme.
8. Narrow window (<768px): rail becomes horizontal chip row.

- [ ] **Step 2: Push and open PR to dev**

```bash
git push -u origin feat/unified-settings
gh pr create --base dev --title "feat: unified settings with tab rail (absorbs profile + usage)" --body "Implements docs/superpowers/specs/2026-08-02-unified-settings-design.md. Frontend-only; zero contract drift."
```

---

## Self-review notes

- Spec coverage: routing (T1), four tabs (T2-T5), shell + a11y + responsive (T6), sidebar + deletion + testid sweep (T7), smoke (T8). Lazy per-tab fetch: each tab fetches in its own `onMounted`, so a request fires only on first activation; the shell's `<KeepAlive>` keeps switched-away tabs alive, satisfying the spec's "switching tabs does not refetch". A fresh page load remounts everything and refetches, as today.
- Type consistency: `tab` prop string slug everywhere; `updateProfile({ name, feedback })` payload shape preserved at both call sites.
- No placeholders: CSS-copy steps name exact source line ranges and rule names.

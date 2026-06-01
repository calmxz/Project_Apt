# Sidebar Header + Settings Redesign Implementation Plan

> **STATUS: COMPLETE (2026-06-01).** All 5 tasks executed via subagent-driven-development on `feat/sidebar-redesign` (head `ba316ae`). Full FE unit suite green at 359/359, lint clean. Per-task spec + quality reviews passed; final holistic review = ready to merge. Live /chrome smoke confirmed desktop three-state header, trimmed footer rail, Settings Appearance instant-toggle, and sign-out placement; mobile strip covered by unit tests (capture viewport pinned ≥1280 so not exercised live). Non-blocking follow-ups: dead `.muted` CSS in SettingsView.vue, stale `user.userId` test assignment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar header read as one unit in every state, slim the footer rail and mobile strip to primary navigation, and relocate theme + sign-out into the Settings page.

**Architecture:** Three frontend Vue components change (`Sidebar.vue`, `SidebarMobileTopStrip.vue`, `SettingsView.vue`). No backend, no routing, no contract changes. The theme toggle uses the existing `useTheme` singleton; sign-out reuses the existing `authStore.signOut()` + `router.push('/login')` handler, moved into Settings. Tasks are ordered so the Settings additions land BEFORE the sidebar/strip removals — sign-out test coverage never disappears and the suite stays green at every commit.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, vue-router, Vitest + @vue/test-utils, PrimeIcons (`pi pi-*`), CSS custom-property design tokens.

**Spec:** `docs/superpowers/specs/2026-06-01-sidebar-header-settings-redesign.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/components/sidebar/Sidebar.vue` | Desktop rail + drawer | Header three-state render + CSS; remove theme/sign-out from footer rail |
| `frontend/src/components/sidebar/SidebarMobileTopStrip.vue` | Mobile top strip | Remove theme + sign-out controls |
| `frontend/src/views/SettingsView.vue` | Settings page | Add Appearance switch (instant, outside form) + sign-out near Danger zone |
| `frontend/src/__tests__/sidebar.test.js` | Sidebar unit tests | Add header-state + footer-removal tests |
| `frontend/src/__tests__/settingsView.test.js` | Settings unit tests | Add theme-switch + sign-out tests; add router/toast mocks |
| `frontend/src/__tests__/appView.test.js` | App-level tests | Delete the now-obsolete sidebar sign-out describe block |
| `frontend/src/__tests__/sidebarMobileStrip.test.js` | Mobile strip unit tests | New file — assert reduced control set |

**Reference facts (verified in the codebase):**
- `useTheme()` returns `{ isDark, toggle, setTheme, resolved, override, init }`. `isDark` is a computed off a module-level singleton; default in jsdom resolves to `light`.
- `useSidebar()` returns `{ mode, isDesktop, drawerOpen, toggleDesktop, openDrawer, closeDrawer, ... }`. Test helpers: `__test__._setViewport(px)`, `__test__._setExpanded(bool)`. Desktop breakpoint is 1280.
- `authStore.signOut()` calls Supabase and throws on error; the test stub is `globalThis.__supabaseAuthStub.signOut` (default resolves `{ error: null }`, reset each test in `setup.js`).
- `Sidebar.vue` uses `showError` (from `useToast`) ONLY inside `onSignOut`. After removing sign-out it is unused and its import is removed.
- `isExpanded` in `Sidebar.vue` is `true` for both `expanded` (desktop) and `drawer-open` (mobile). So `v-if="isExpanded"` on the brand shows the logo on desktop-expanded and mobile-drawer, hides it on desktop-collapsed — exactly the three-state behavior.

---

## Task 1: Sidebar header — three states

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (header template ~177-208; CSS `.sb-header` ~439-451)
- Test: `frontend/src/__tests__/sidebar.test.js`

- [ ] **Step 1: Write the failing tests**

Add this `import` to the existing imports near the top of `sidebar.test.js` (it already imports `{ __test__ as sidebarTest }` from the same module — extend that line):

```js
import { useSidebar, __test__ as sidebarTest } from '@/composables/useSidebar.js'
```

Append this describe block at the end of `sidebar.test.js`:

```js
describe('Sidebar.vue — header states', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
  })
  afterEach(() => wrapper?.unmount())

  it('expanded desktop header shows the logo and a collapse toggle', async () => {
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-brand').exists()).toBe(true)
    const toggle = wrapper.find('[data-testid="sidebar-collapse-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('Collapse sidebar')
  })

  it('collapsed desktop header shows only the expand toggle, no logo', async () => {
    sidebarTest._setExpanded(false)
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-brand').exists()).toBe(false)
    const toggle = wrapper.find('[data-testid="sidebar-collapse-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('Expand sidebar')
  })

  it('mobile drawer header shows the logo and a right-aligned close button', async () => {
    setViewport(600)
    const { openDrawer, closeDrawer } = useSidebar()
    openDrawer()
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-brand').exists()).toBe(true)
    const close = wrapper.find('[data-testid="sidebar-drawer-close"]')
    expect(close.exists()).toBe(true)
    expect(close.classes()).toContain('sb-toggle--end')
    closeDrawer()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js -t "header states"`
Expected: FAIL — collapsed test fails (`.sb-brand` still renders the mark-only logo when collapsed); mobile test fails (`sb-toggle--end` class not present).

- [ ] **Step 3: Edit the header template**

In `Sidebar.vue`, add `v-if="isExpanded"` to the brand link and `sb-toggle--end` to the drawer-close button. The header block becomes:

```html
    <div class="sb-header">
      <RouterLink
        v-if="isExpanded"
        to="/"
        class="sb-brand"
        aria-label="AdaptLearn home"
        @click="closeDrawer"
      >
        <Logo size="md" variant="full" />
      </RouterLink>
      <button
        v-if="showCollapseToggle"
        type="button"
        class="sb-toggle"
        :aria-label="isExpanded ? 'Collapse sidebar' : 'Expand sidebar'"
        :title="isExpanded ? 'Collapse sidebar' : 'Expand sidebar'"
        data-testid="sidebar-collapse-toggle"
        @click="toggleDesktop"
      >
        <i :class="isExpanded ? 'pi pi-angle-double-left' : 'pi pi-angle-double-right'" />
      </button>
      <button
        v-if="showDrawerClose"
        type="button"
        class="sb-toggle sb-toggle--end"
        aria-label="Close sessions sidebar"
        title="Close"
        data-testid="sidebar-drawer-close"
        @click="closeDrawer"
      >
        <i class="pi pi-times" />
      </button>
    </div>
```

The `Logo` `:variant` prop is now hardcoded `"full"` because the logo only renders when expanded (the old `mark-only` collapsed case no longer exists).

- [ ] **Step 4: Edit the header CSS**

In `Sidebar.vue` `<style>`, remove `justify-content: space-between;` from `.sb-header` and add a `.sb-toggle--end` rule. The `.sb-header` rule becomes:

```css
.sb-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  min-height: 3.25rem;
}
```

Immediately after the existing `.sidebar--collapsed .sb-header { ... }` rule, add:

```css
.sb-toggle--end {
  margin-left: auto;
}
```

(The existing `.sidebar--collapsed .sb-header { justify-content: center; padding: 0.75rem 0.25rem; }` rule stays — it centers the lone toggle when collapsed.)

- [ ] **Step 5: Run tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js`
Expected: PASS (all sidebar tests, including the three new header-state tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(sidebar): three-state header — logo only when expanded, tight collapse toggle"
```

---

## Task 2: Settings — Appearance switch (instant) + sign-out near Danger zone

**Files:**
- Modify: `frontend/src/views/SettingsView.vue` (script + template + style)
- Test: `frontend/src/__tests__/settingsView.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the top of `settingsView.test.js` (the imports + toast mock, lines 1-21) with this — it adds a `showError` spy, a `vue-router` mock, and the auth/theme imports:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SettingsView from '@/views/SettingsView.vue'
import { useUserStore } from '@/stores/user.js'
import { useAuthStore } from '@/stores/auth.js'
import { useTheme } from '@/composables/useTheme.js'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))
const routerPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}))

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button />', props: ['label', 'fallback'] },
  Button: {
    props: ['disabled', 'label'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
  },
}
```

In the existing `beforeEach` (the `setActivePinia` block), add these resets after `showSuccess.mockClear()`:

```js
    showError.mockClear()
    routerPush.mockClear()
    useTheme().setTheme('light')
```

Append these tests inside the existing `describe('SettingsView', ...)` block:

```js
  it('appearance switch reflects and toggles dark mode', async () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    const sw = wrapper.get('[data-testid="settings-theme-toggle"]')
    expect(sw.attributes('role')).toBe('switch')
    expect(sw.attributes('aria-checked')).toBe('false')
    await sw.trigger('click')
    expect(sw.attributes('aria-checked')).toBe('true')
  })

  it('sign-out button is hidden when unauthenticated', () => {
    const wrapper = mount(SettingsView, { global: { stubs } })
    expect(wrapper.find('[data-testid="settings-sign-out"]').exists()).toBe(false)
  })

  it('sign-out signs out and redirects to /login', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(globalThis.__supabaseAuthStub.signOut).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith('/login')
  })

  it('sign-out surfaces an error toast and does not redirect on failure', async () => {
    globalThis.__supabaseAuthStub.signOut.mockResolvedValueOnce({
      error: new Error('network down'),
    })
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const wrapper = mount(SettingsView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('network down')
    expect(routerPush).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/settingsView.test.js`
Expected: FAIL — `settings-theme-toggle` and `settings-sign-out` do not exist yet.

- [ ] **Step 3: Edit the SettingsView script**

In `SettingsView.vue` `<script setup>`, extend the imports and wiring. Change the import section and the store/composable setup to:

```js
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BackButton from '../components/BackButton.vue'
import { useUserStore } from '../stores/user.js'
import { useAuthStore } from '../stores/auth.js'
import { useTheme } from '../composables/useTheme.js'
import { useToast } from '../composables/useToast.js'

const user = useUserStore()
const authStore = useAuthStore()
const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()
const { showSuccess, showError } = useToast()
```

Add this handler next to the existing `save()` function:

```js
async function signOut() {
  try {
    await authStore.signOut()
  } catch (err) {
    showError(err?.message || 'Sign out failed')
    return
  }
  router.push('/login')
}
```

- [ ] **Step 4: Edit the SettingsView template**

Add the Appearance card and the sign-out block. Insert them AFTER the closing `</form>` tag and BEFORE the `<section class="danger" ...>` block:

```html
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

    <section
      v-if="authStore.isAuthenticated"
      class="signout"
      data-testid="settings-signout-section"
    >
      <button
        type="button"
        class="signout-btn"
        data-testid="settings-sign-out"
        @click="signOut"
      >
        <i class="pi pi-sign-out" aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </section>
```

- [ ] **Step 5: Add the styles**

Append to the `SettingsView.vue` `<style scoped>` block:

```css
/* Appearance switch */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.switch-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.switch-label {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.switch-sub {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.switch {
  position: relative;
  flex-shrink: 0;
  width: 2.75rem;
  height: 1.5rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-soft);
  cursor: pointer;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.switch--on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.switch:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.switch-knob {
  position: absolute;
  top: 50%;
  left: 0.1875rem;
  width: 1.125rem;
  height: 1.125rem;
  transform: translateY(-50%);
  border-radius: var(--radius-pill);
  background: #FFFFFF;
  box-shadow: var(--shadow-pop);
  transition: left var(--motion-fast) var(--motion-bounce);
}

.switch--on .switch-knob {
  left: calc(100% - 1.3125rem);
}

/* Sign out */
.signout {
  display: flex;
}

.signout-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-strong);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.signout-btn:hover {
  color: var(--color-heading);
  border-color: var(--color-text-muted);
  transform: translateY(-1px);
}

.signout-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/settingsView.test.js`
Expected: PASS (existing save tests + 4 new tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/SettingsView.vue frontend/src/__tests__/settingsView.test.js
git commit -m "feat(settings): add Appearance dark-mode switch and sign-out action"
```

---

## Task 3: Remove theme + sign-out from the sidebar footer rail

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (footer template ~338-376; script ~8,18,25,140-148)
- Modify: `frontend/src/__tests__/appView.test.js` (delete the sidebar sign-out describe block)
- Test: `frontend/src/__tests__/sidebar.test.js` (add a removal assertion)

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('Sidebar.vue — footer rail labels', ...)` block in `sidebar.test.js`:

```js
  it('footer rail no longer renders theme or sign-out controls', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-theme-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-sign-out"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-profile"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-settings"]').exists()).toBe(true)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js -t "no longer renders theme"`
Expected: FAIL — both controls still render in the footer rail.

- [ ] **Step 3: Remove the footer controls from the template**

In `Sidebar.vue`, delete the theme-toggle `<button>` block (the one with `data-testid="sidebar-theme-toggle"`, `role="switch"`, toggling `toggleTheme`) and the sign-out `<button>` block (`data-testid="sidebar-sign-out"`, `@click="onSignOut"`). The `<footer class="sb-rail" ...>` keeps exactly two children: the Profile `RouterLink` (`data-testid="sidebar-profile"`) and the Settings `RouterLink` (`data-testid="sidebar-settings"`).

- [ ] **Step 4: Remove the now-unused script wiring**

In `Sidebar.vue` `<script setup>`:
- Delete the import line `import { useTheme } from '@/composables/useTheme.js'`.
- Delete the import line `import { useToast } from '@/composables/useToast.js'`.
- Delete `const { isDark, toggle: toggleTheme } = useTheme()`.
- Delete `const { showError } = useToast()`.
- Delete the entire `onSignOut` function (the `async function onSignOut() { ... }` block).

Keep `useAuthStore`/`isAuthenticated` (used by the `onMounted` fetch), `useRouter`/`router` (used by `onNewSession`), and `useRoute`/`route`.

- [ ] **Step 5: Delete the obsolete appView sign-out tests**

In `appView.test.js`, delete the entire `describe('App.vue sign-out button', () => { ... })` block (the second describe in the file). Leave the `describe('App.vue error listener', ...)` block and all mocks untouched (the `routerPush` mock stays — it is referenced by the `vue-router` mock).

- [ ] **Step 6: Run the affected suites to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebar.test.js src/__tests__/appView.test.js`
Expected: PASS — sidebar removal test passes; appView no longer references `sidebar-sign-out`.

- [ ] **Step 7: Confirm no dangling references**

Run (from repo root): `git grep -n "sidebar-sign-out\|sidebar-theme-toggle" frontend/src`
Expected: no matches (the testids are fully gone). If any remain, remove them.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js frontend/src/__tests__/appView.test.js
git commit -m "feat(sidebar): drop theme + sign-out from footer rail (moved to Settings)"
```

---

## Task 4: Remove theme + sign-out from the mobile top strip

**Files:**
- Modify: `frontend/src/components/sidebar/SidebarMobileTopStrip.vue`
- Create: `frontend/src/__tests__/sidebarMobileStrip.test.js`

- [ ] **Step 1: Write the failing test (new file)**

Create `frontend/src/__tests__/sidebarMobileStrip.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}))

import SidebarMobileTopStrip from '@/components/sidebar/SidebarMobileTopStrip.vue'

describe('SidebarMobileTopStrip', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => wrapper?.unmount())

  it('renders the hamburger, logo, and profile link', () => {
    wrapper = mount(SidebarMobileTopStrip)
    expect(wrapper.find('[data-testid="sidebar-mobile-hamburger"]').exists()).toBe(true)
    expect(wrapper.find('.sb-strip-brand').exists()).toBe(true)
    expect(wrapper.find('[data-testid="strip-profile"]').exists()).toBe(true)
  })

  it('no longer renders theme or sign-out controls', () => {
    wrapper = mount(SidebarMobileTopStrip)
    expect(wrapper.find('[data-testid="strip-theme-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="strip-sign-out"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebarMobileStrip.test.js`
Expected: FAIL — `strip-theme-toggle` and `strip-sign-out` still render.

- [ ] **Step 3: Rewrite the mobile strip component**

Replace the full contents of `SidebarMobileTopStrip.vue` with (template `<style>` block unchanged — only the script and the two removed buttons differ):

```html
<script setup>
import { RouterLink } from 'vue-router'
import { useSidebar } from '@/composables/useSidebar.js'
import Logo from '@/components/Logo.vue'

const { openDrawer } = useSidebar()
</script>

<template>
  <div class="sb-strip" data-testid="sidebar-mobile-strip">
    <button
      type="button"
      class="sb-strip-btn"
      aria-label="Open sessions sidebar"
      title="Sessions"
      data-testid="sidebar-mobile-hamburger"
      @click="openDrawer"
    >
      <i class="pi pi-bars" />
    </button>
    <RouterLink to="/" class="sb-strip-brand" aria-label="AdaptLearn home">
      <Logo size="sm" variant="full" />
    </RouterLink>
    <div class="sb-strip-actions">
      <RouterLink
        to="/profile"
        class="sb-strip-btn"
        aria-label="Combined profile"
        title="Combined profile"
        data-testid="strip-profile"
      >
        <i class="pi pi-user" />
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.sb-strip {
  position: sticky;
  top: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: var(--sidebar-mobile-strip-height, 3rem);
  padding: 0 0.5rem;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.sb-strip-brand {
  display: inline-flex;
  text-decoration: none;
  margin-right: auto;
  padding: 0 0.25rem;
}

.sb-strip-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.sb-strip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  text-decoration: none;
  cursor: pointer;
  font-size: 1rem;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.sb-strip-btn:hover {
  color: var(--color-accent-text);
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
}

.sb-strip-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npm run test:unit -- --run src/__tests__/sidebarMobileStrip.test.js`
Expected: PASS.

- [ ] **Step 5: Confirm no dangling references**

Run (from repo root): `git grep -n "strip-theme-toggle\|strip-sign-out" frontend/src`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sidebar/SidebarMobileTopStrip.vue frontend/src/__tests__/sidebarMobileStrip.test.js
git commit -m "feat(sidebar): slim mobile strip to hamburger + logo + profile"
```

---

## Task 5: Full-suite verification + lint

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend unit suite**

Run (from `frontend/`): `npm run test:unit -- --run`
Expected: PASS, with the suite count at or above the 351 baseline (Task 1 adds 3, Task 2 adds 4, Task 3 adds 1, Task 4 adds 2; the deleted appView block removes 2 — net +8, so ~359 tests). No failures.

- [ ] **Step 2: Lint**

Run (from `frontend/`): `npm run lint`
Expected: clean (no errors). In particular, confirm no `no-unused-vars` from leftover `useTheme`/`useToast`/`useAuthStore` imports in `Sidebar.vue` or `SidebarMobileTopStrip.vue`.

- [ ] **Step 3: Manual visual check (running app)**

The dev server is already running at `http://localhost:5173` (logged in). Verify at desktop width (≥1280):
- Expanded header: logo + name with the collapse `«` tight beside it (no far-right gap).
- Collapsed header (click `«`): only the expand `»` toggle, no logo mark.
- Footer rail: only Profile + Settings.
- Settings page: Appearance card with a "Dark mode" switch that flips the theme instantly; a low-key "Sign out" button near the Danger zone.

At mobile width (<1280): top strip shows hamburger + logo + profile only.

- [ ] **Step 4: Mark the plan complete**

Tick the checkboxes in this file and note completion in the spec if needed.

---

## Self-Review

**Spec coverage:**
- Header three states → Task 1. ✓
- Footer rail to Profile + Settings → Task 3. ✓
- Mobile strip to hamburger + logo + profile → Task 4. ✓
- Settings Appearance switch ("Dark mode" state label, instant, outside form) → Task 2. ✓
- Sign-out near Danger zone (low-key outlined) → Task 2. ✓
- Theme-label wording bug fixed (state label, not action) → Task 2 uses "Dark mode". ✓
- Test churn in-scope (sidebar / a11y / settings / appView / mobile strip) → Tasks 1-4. Note: `sidebarA11y.test.js` was verified to contain NO theme/sign-out assertions, so it needs no change. ✓
- Accepted trade-off (collapsed removes home link) → implemented by Task 1's `v-if="isExpanded"` on the brand; documented in spec. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type/name consistency:** testids consistent across tasks (`settings-theme-toggle`, `settings-sign-out`, `sidebar-collapse-toggle`, `sidebar-drawer-close`, `strip-profile`); `toggleTheme`/`isDark`/`signOut` names match between SettingsView script and template; `sb-toggle--end` used in both Task 1 template and test. ✓

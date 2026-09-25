import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import SettingsView from '../views/SettingsView.vue'
import { useAuthStore } from '../stores/auth.js'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('../composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

const getUsageSummary = vi.fn()
vi.mock('../services/profileApi.js', () => ({
  getUsageSummary: (...a) => getUsageSummary(...a),
}))

function minimalUsageFixture() {
  return {
    daily: [],
    today_spend_usd: 0,
    hard_cap_usd: 0.3,
    soft_cap_usd: 0.15,
    urgent_cap_usd: 0.25,
    top_sessions: [],
  }
}

const stubs = {
  LearningTab: { template: '<div data-testid="stub-learning" />' },
  UsageTab: { template: '<div data-testid="stub-usage" />' },
  AppearanceTab: { template: '<div data-testid="stub-appearance" />' },
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/:tab', name: 'settings', component: SettingsView, props: true },
      { path: '/account', name: 'account', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
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
  beforeEach(() => setActivePinia(createPinia()))

  it('renders three rail tabs with testids', async () => {
    const { w } = await mountAt('learning')
    for (const slug of ['learning', 'usage', 'appearance']) {
      expect(w.find(`[data-testid="settings-tab-${slug}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="settings-tab-rail"]').attributes('role')).toBe('tablist')
    expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual([
      'Learning',
      'Usage',
      'Appearance',
    ])
  })

  it('R2: rail tabs carry coarse-2x for a coarse-pointer two-pitch target', async () => {
    const { w } = await mountAt('learning')
    expect(w.find('[data-testid="settings-tab-learning"]').classes()).toContain('coarse-2x')
  })

  it('active tab follows the tab prop', async () => {
    const { w } = await mountAt('usage')
    expect(w.find('[data-testid="stub-usage"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-learning"]').exists()).toBe(false)
    expect(w.find('[data-testid="settings-tab-usage"]').attributes('aria-selected')).toBe('true')
  })

  it('clicking a rail tab pushes the route', async () => {
    const { w, router } = await mountAt('learning')
    await w.find('[data-testid="settings-tab-usage"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('usage')
  })

  it('arrow key moves selection to the next tab (a11y)', async () => {
    const { w, router } = await mountAt('learning')
    await w.find('[data-testid="settings-tab-learning"]').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('usage')
  })

  it('pressing ArrowDown twice moves two tabs forward (real focus must follow activation)', async () => {
    const router = makeRouter()
    await router.push('/settings/learning')
    const w = mount(SettingsView, {
      props: { tab: 'learning' },
      global: { plugins: [router], stubs },
      attachTo: document.body,
    })

    // Dispatch a real (bubbling) keydown on the learning tab button, the way
    // a keyboard user would. Do NOT re-query by testid for the second press
    // -- with roving tabindex the second ArrowDown must land wherever DOM
    // focus actually is.
    w.find('[data-testid="settings-tab-learning"]').element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    )
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('usage')
    expect(document.activeElement?.getAttribute('data-testid')).toBe('settings-tab-usage')

    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    )
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('appearance')

    w.unmount()
  })

  it('KeepAlive prevents UsageTab refetch when navigating usage -> learning -> usage', async () => {
    setActivePinia(createPinia())
    getUsageSummary.mockReset().mockResolvedValue(minimalUsageFixture())

    const router = makeRouter()
    await router.push('/settings/usage')

    const Root = { template: '<router-view />' }
    const w = mount(Root, {
      global: {
        plugins: [router],
        stubs: { AppearanceTab: stubs.AppearanceTab },
      },
    })
    await flushPromises()
    expect(getUsageSummary).toHaveBeenCalledTimes(1)

    await w.find('[data-testid="settings-tab-learning"]').trigger('click')
    await flushPromises()
    await w.find('[data-testid="settings-tab-usage"]').trigger('click')
    await flushPromises()
    expect(getUsageSummary).toHaveBeenCalledTimes(1)

    w.unmount()
  })
})

// The sidebar identity row now opens Settings directly, so the old user
// menu's Account and Sign out entries live here instead.
describe('SettingsView account links', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    showError.mockClear()
    useAuthStore().session = { user: { id: 'u-1', email: 'ada@example.com' }, access_token: 't' }
  })

  it('links to the Account page', async () => {
    const { w, router } = await mountAt('learning')
    const link = w.get('[data-testid="settings-account-link"]')
    expect(link.text()).toBe('Account')
    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('account')
  })

  it('signs out and redirects to /login', async () => {
    const { w, router } = await mountAt('learning')
    await w.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(globalThis.__supabaseAuthStub.signOut).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('surfaces an error toast and still leaves the protected route on failure', async () => {
    globalThis.__supabaseAuthStub.signOut.mockResolvedValueOnce({
      error: new Error('network down'),
    })
    const { w, router } = await mountAt('learning')
    await w.get('[data-testid="settings-sign-out"]').trigger('click')
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('network down')
    // The store clears the local session in its finally, so the shell is
    // already signed out; staying on a protected route would strand the
    // learner behind a toast.
    expect(router.currentRoute.value.path).toBe('/login')
  })
})

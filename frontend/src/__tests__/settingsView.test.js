import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import SettingsView from '../views/SettingsView.vue'

const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('../composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

const getUsageSummary = vi.fn()
vi.mock('../services/profileApi.js', () => ({
  getUsageSummary: (...a) => getUsageSummary(...a),
}))

// ProfileTab lists topics from GET /sessions now, not the aggregate profile.
const listSessions = vi.fn()
vi.mock('../services/sessionsApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listSessions: (...a) => listSessions(...a),
}))

function minimalSessionsFixture() {
  return [
    {
      id: 's1',
      topic: 'sql joins',
      created_at: '2026-09-10T10:00:00Z',
      ended_at: null,
      pinned: false,
      last_activity_at: '2026-09-10T11:00:00Z',
      progress: { focus_target_gap: null, level: 'beginner', mastered_count: 0 },
    },
  ]
}

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
  ProfileTab: { template: '<div data-testid="stub-profile" />' },
  UsageTab: { template: '<div data-testid="stub-usage" />' },
  AccountTab: { template: '<div data-testid="stub-account" />' },
  AppearanceTab: { template: '<div data-testid="stub-appearance" />' },
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/:tab', name: 'settings', component: SettingsView, props: true },
      // ProfileTab's topic rows link here; without the route vue-router
      // throws an unhandled "No match" while resolving the link.
      {
        path: '/sessions/:id/profile',
        name: 'session-profile',
        component: { template: '<div />' },
      },
      { path: '/new', name: 'new-session', component: { template: '<div />' } },
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
  it('renders four rail tabs with testids', async () => {
    const { w } = await mountAt('profile')
    for (const slug of ['profile', 'usage', 'account', 'appearance']) {
      expect(w.find(`[data-testid="settings-tab-${slug}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="settings-tab-rail"]').attributes('role')).toBe('tablist')
  })

  it('R2: rail tabs carry coarse-2x for a coarse-pointer two-pitch target', async () => {
    const { w } = await mountAt('profile')
    expect(w.find('[data-testid="settings-tab-profile"]').classes()).toContain('coarse-2x')
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

  it('pressing ArrowDown twice moves two tabs forward (real focus must follow activation)', async () => {
    const router = makeRouter()
    await router.push('/settings/profile')
    const w = mount(SettingsView, {
      props: { tab: 'profile' },
      global: { plugins: [router], stubs },
      attachTo: document.body,
    })

    // Dispatch a real (bubbling) keydown on the profile tab button, the way
    // a keyboard user would. Do NOT re-query by testid for the second press
    // -- with roving tabindex the second ArrowDown must land wherever DOM
    // focus actually is.
    w.find('[data-testid="settings-tab-profile"]').element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    )
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('usage')
    expect(document.activeElement?.getAttribute('data-testid')).toBe('settings-tab-usage')

    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    )
    await flushPromises()
    expect(router.currentRoute.value.params.tab).toBe('account')

    w.unmount()
  })

  it('KeepAlive prevents ProfileTab refetch when navigating profile -> usage -> profile', async () => {
    setActivePinia(createPinia())
    listSessions.mockReset().mockResolvedValue(minimalSessionsFixture())
    getUsageSummary.mockReset().mockResolvedValue(minimalUsageFixture())

    const router = makeRouter()
    await router.push('/settings/profile')

    const Root = { template: '<router-view />' }
    const w = mount(Root, {
      global: {
        plugins: [router],
        stubs: { AccountTab: stubs.AccountTab, AppearanceTab: stubs.AppearanceTab },
      },
    })
    await flushPromises()
    expect(listSessions).toHaveBeenCalledTimes(1)

    await w.find('[data-testid="settings-tab-usage"]').trigger('click')
    await flushPromises()
    expect(getUsageSummary).toHaveBeenCalledTimes(1)

    await w.find('[data-testid="settings-tab-profile"]').trigger('click')
    await flushPromises()
    expect(listSessions).toHaveBeenCalledTimes(1)

    w.unmount()
  })
})

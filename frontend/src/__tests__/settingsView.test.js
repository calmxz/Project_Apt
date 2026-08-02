import { describe, it, expect } from 'vitest'
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

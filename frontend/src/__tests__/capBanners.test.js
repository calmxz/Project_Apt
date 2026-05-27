import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import CapBanners from '@/components/chat/CapBanners.vue'
import { useSessionStore } from '@/stores/session.js'

describe('CapBanners', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders nothing when no caps reached', () => {
    const wrapper = mount(CapBanners)
    expect(wrapper.find('[data-testid="session-cap-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="session-cost-cap-banner"]').exists()).toBe(false)
    expect(wrapper.text().trim()).toBe('')
  })

  it('shows daily-cap banner with correct text when dailyCapInfo is set', async () => {
    const store = useSessionStore()
    store.dailyCapInfo = { cap: 30, used: 30, resets_at: '2026-05-25T00:00:00Z' }
    const wrapper = mount(CapBanners)
    const banner = wrapper.find('[data-testid="session-cap-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Daily limit reached')
    expect(banner.text()).toContain('30/30')
    expect(wrapper.find('[data-testid="session-cost-cap-banner"]').exists()).toBe(false)
  })

  it('shows cost-cap banner with correct text when costCapInfo is set', async () => {
    const store = useSessionStore()
    store.costCapInfo = {
      used_usd: '3.10',
      soft_cap_usd: '2.0',
      hard_cap_usd: '3.00',
      resets_at: '2026-05-25T00:00:00Z',
    }
    const wrapper = mount(CapBanners)
    const banner = wrapper.find('[data-testid="session-cost-cap-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Daily cost limit reached')
    expect(banner.text()).toContain('$3.10 of $3.00')
    expect(wrapper.find('[data-testid="session-cap-banner"]').exists()).toBe(false)
  })

  it('shows both banners when both caps are reached', async () => {
    const store = useSessionStore()
    store.dailyCapInfo = { cap: 30, used: 30, resets_at: '2026-05-25T00:00:00Z' }
    store.costCapInfo = {
      used_usd: '3.10',
      soft_cap_usd: '2.0',
      hard_cap_usd: '3.00',
      resets_at: '2026-05-25T00:00:00Z',
    }
    const wrapper = mount(CapBanners)
    expect(wrapper.find('[data-testid="session-cap-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="session-cost-cap-banner"]').exists()).toBe(true)
  })
})

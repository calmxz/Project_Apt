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

import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UsagePanel from '../components/profile/UsagePanel.vue'

const usage = (overrides = {}) => ({
  daily: [
    { date_utc: '2026-07-09', cost_usd: 0.5 },
    { date_utc: '2026-07-10', cost_usd: 1.0 },
  ],
  today_spend_usd: 1.0,
  soft_cap_usd: 2.0,
  urgent_cap_usd: 2.7,
  hard_cap_usd: 3.0,
  top_sessions: [],
  ...overrides,
})

const factory = (u = usage()) =>
  mount(UsagePanel, {
    props: { usage: u },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('UsagePanel', () => {
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

  it('positions tier markers from response values, not literals', () => {
    const w = factory(usage({ hard_cap_usd: 4.0, soft_cap_usd: 1.0, urgent_cap_usd: 3.6 }))
    const markers = w.findAll('.tier-marker')
    expect(markers).toHaveLength(2) // soft + urgent; hard = 100% end
    expect(markers[0].attributes('style')).toContain('left: 25%') // 1.0 / 4.0
    expect(markers[1].attributes('style')).toContain('left: 90%') // 3.6 / 4.0
  })

  it('fills the meter to today/hard ratio', () => {
    const w = factory() // 1.0 / 3.0
    expect(w.find('.meter-fill').attributes('style')).toContain('width: 33%')
  })

  it('lists top sessions with links', () => {
    const w = factory(
      usage({
        top_sessions: [{ session_id: 's9', topic: 'algebra', cost_usd: 0.42 }],
      }),
    )
    const link = w.findComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({
      name: 'session-profile',
      params: { id: 's9' },
    })
    expect(w.text()).toContain('algebra')
    expect(w.text()).toContain('$0.42')
  })

  it('shows empty state when there is no spend at all', () => {
    const w = factory(
      usage({
        daily: [
          { date_utc: '2026-07-09', cost_usd: 0 },
          { date_utc: '2026-07-10', cost_usd: 0 },
        ],
        today_spend_usd: 0,
      }),
    )
    expect(w.find('[data-testid="usage-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="usage-glance"]').exists()).toBe(false)
  })
})

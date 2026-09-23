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
  it('renders the today figure, daily cap caption, and last-7-days line', () => {
    const w = factory()
    const glance = w.find('[data-testid="usage-glance"]')
    expect(glance.find('.glance-figure').text()).toBe('$1.00')
    expect(glance.find('.glance-caption').text()).toBe('today · $3.00 daily cap')
    expect(glance.find('.glance-week').text()).toBe('Last 7 days $1.50')
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
    const glance = w.find('[data-testid="usage-glance"]')
    expect(glance.find('.glance-figure').text()).toBe('$0.10')
    expect(glance.find('.glance-week').text()).toBe('Last 7 days $0.70')
  })

  it('lists the last 7 days as ledger rows, most recent first', () => {
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
    const rows = w.findAll('[data-testid="usage-ledger-row"]')
    expect(rows).toHaveLength(7)
    expect(rows[0].text()).toContain('Jul 10')
    expect(rows[0].text()).toContain('$0.10')
    expect(rows.some((r) => r.text().includes('Jul 3'))).toBe(false)
  })

  it('sizes ledger bars proportionally to the max day, with no bar for zero-cost days', () => {
    const w = factory(
      usage({
        daily: [
          { date_utc: '2026-07-09', cost_usd: 0 },
          { date_utc: '2026-07-10', cost_usd: 0.5 },
          { date_utc: '2026-07-11', cost_usd: 1.0 },
        ],
      }),
    )
    const rows = w.findAll('[data-testid="usage-ledger-row"]')
    // most recent first: Jul 11 (1.0, max) -> Jul 10 (0.5) -> Jul 9 (0)
    expect(rows[0].find('.ledger-bar').attributes('style')).toContain('width: 100%')
    expect(rows[1].find('.ledger-bar').attributes('style')).toContain('width: 50%')
    expect(rows[2].find('.ledger-bar').attributes('style')).toContain('width: 0%')
    expect(rows[2].find('.ledger-bar').classes()).not.toContain('ledger-bar--filled')
    expect(rows[0].find('.ledger-bar').classes()).toContain('ledger-bar--filled')
  })

  it('shows the meter tier labels with soft/urgent amounts and the cap in the glance caption', () => {
    const w = factory(usage({ hard_cap_usd: 4.0, soft_cap_usd: 1.0, urgent_cap_usd: 3.6 }))
    expect(w.find('.meter-label-soft').text()).toBe('soft $1.00')
    expect(w.find('.meter-label-urgent').text()).toBe('urgent $3.60')
    expect(w.find('.glance-caption').text()).toContain('$4.00 daily cap')
  })

  it('renders the "$x.xx of $y.yy today" figure in tabular figures beside the meter', () => {
    const w = factory(usage({ today_spend_usd: 1.0, hard_cap_usd: 3.0 }))
    const figure = w.find('.meter-figure')
    expect(figure.text()).toBe('$1.00 of $3.00 today')
    expect(figure.attributes('data-tabular')).toBeDefined()
  })

  it('names the meter once, by percentage of cap, with no duplicate hidden text', () => {
    const w = factory(usage({ today_spend_usd: 1.0, hard_cap_usd: 4.0 }))
    const meter = w.find('.meter')
    expect(meter.attributes('role')).toBe('img')
    expect(meter.attributes('aria-label')).toBe('25% of daily cap spent')
    expect(w.find('.meter-wrap .sr-only').exists()).toBe(false)
    expect(w.text()).not.toContain('25% of daily cap spent')
  })

  it('keeps the tier labels in the same column as the meter so they line up with the ticks', () => {
    const w = factory()
    const col = w.find('.meter-col')
    expect(col.find('.meter').exists()).toBe(true)
    expect(col.find('.meter-labels').exists()).toBe(true)
    expect(col.find('.meter-figure').exists()).toBe(false)
  })

  it('positions three ticks (soft, urgent, hard) as a fraction of the hard cap', () => {
    const w = factory(usage({ hard_cap_usd: 4.0, soft_cap_usd: 1.0, urgent_cap_usd: 3.6 }))
    const soft = w.find('[data-testid="usage-tick-soft"]')
    const urgent = w.find('[data-testid="usage-tick-urgent"]')
    const hard = w.find('[data-testid="usage-tick-hard"]')
    expect(soft.attributes('style')).toContain('left: 25%') // 1.0 / 4.0
    expect(urgent.attributes('style')).toContain('left: 90%') // 3.6 / 4.0
    expect(hard.attributes('style')).toContain('left: 100%')
  })

  it('fills the meter to today/hard ratio and stays blue under the urgent cap', () => {
    const w = factory() // 1.0 / 3.0, urgent cap 2.7 -- not reached
    const fill = w.find('.meter-fill')
    expect(fill.attributes('style')).toContain('width: 33%')
    expect(fill.classes()).not.toContain('meter-fill--over-urgent')
  })

  it('turns the meter fill text-safe red once spend passes the urgent cap', () => {
    const w = factory(usage({ today_spend_usd: 2.8, urgent_cap_usd: 2.7, hard_cap_usd: 3.0 }))
    expect(w.find('.meter-fill').classes()).toContain('meter-fill--over-urgent')
  })

  it('renders seven week columns padded to a full week, with today marked last', () => {
    const w = factory(
      usage({
        daily: [
          { date_utc: '2026-07-09', cost_usd: 0.5 },
          { date_utc: '2026-07-10', cost_usd: 1.0 },
        ],
      }),
    )
    const cols = w.findAll('[data-testid="usage-week-col"]')
    expect(cols).toHaveLength(7)
    // 5 padded zero-cost columns, then the 2 real days; today is the last column.
    expect(cols[6].attributes('data-today')).toBe('true')
    for (let i = 0; i < 6; i++) {
      expect(cols[i].attributes('data-today')).toBe('false')
    }
  })

  it('makes the last column today, labelled with the newest date', () => {
    const w = factory(
      usage({
        daily: [
          { date_utc: '2026-07-09', cost_usd: 0.5 },
          { date_utc: '2026-07-10', cost_usd: 1.0 },
        ],
      }),
    )
    const cols = w.findAll('[data-testid="usage-week-col"]')
    const last = cols[cols.length - 1]
    expect(last.attributes('data-today')).toBe('true')
    expect(last.find('title').text()).toBe('Jul 10: $1.00')
    const labels = w.findAll('.week-labels .week-label')
    expect(labels).toHaveLength(7)
    expect(labels[6].text()).toBe('Fri')
  })

  it('gives every day, zero included, a full-band hover target carrying its title', () => {
    const w = factory()
    const hits = w.findAll('[data-testid="usage-week-hit"]')
    expect(hits).toHaveLength(7)
    expect(hits[0].find('title').text()).toBe('No data: $0.00')
    expect(Number(hits[0].attributes('height'))).toBeGreaterThan(0)
  })

  it('draws the cap line inside the plot, never at the clipped SVG edge', () => {
    const under = factory()
    const lineUnder = under.find('[data-testid="usage-cap-line"]')
    expect(lineUnder.exists()).toBe(true)
    expect(Number(lineUnder.attributes('y1'))).toBe(8)
    expect(under.find('[data-testid="usage-cap-label"]').text()).toBe('cap $3.00')

    const over = factory(
      usage({
        daily: [
          { date_utc: '2026-07-09', cost_usd: 0.5 },
          { date_utc: '2026-07-10', cost_usd: 6.0 },
        ],
      }),
    )
    const y = Number(over.find('[data-testid="usage-cap-line"]').attributes('y1'))
    // Plot spans [8, 96]; cap 3.0 against a 6.0 max sits halfway down.
    expect(y).toBeGreaterThan(8)
    expect(y).toBeLessThan(96)
    expect(y).toBe(52)
  })

  it('draws no hidden week table: the ledger rows are the accessible table for the chart', () => {
    const w = factory()
    expect(w.find('[data-testid="usage-week-table"]').exists()).toBe(false)
    expect(w.find('[data-testid="usage-ledger"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="usage-ledger-row"]').length).toBeGreaterThan(0)
    expect(w.find('svg.week-svg').attributes('aria-hidden')).toBe('true')
    expect(w.find('[data-testid="usage-week"] .sub-title').text()).toBe('This week')
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

  it('ranks top sessions in order', () => {
    const w = factory(
      usage({
        top_sessions: [
          { session_id: 's9', topic: 'algebra', cost_usd: 0.42 },
          { session_id: 's8', topic: 'geometry', cost_usd: 0.3 },
        ],
      }),
    )
    const ranks = w.findAll('.top-rank')
    expect(ranks).toHaveLength(2)
    expect(ranks[0].text()).toBe('1.')
    expect(ranks[1].text()).toBe('2.')
  })

  it('sizes the top session bar proportionally to the max, longest at 100%', () => {
    const w = factory(
      usage({
        top_sessions: [
          { session_id: 's9', topic: 'algebra', cost_usd: 0.42 },
          { session_id: 's8', topic: 'geometry', cost_usd: 0.21 },
        ],
      }),
    )
    const rows = w.findAll('[data-testid="usage-top-session"]')
    expect(rows).toHaveLength(2)
    const bars = w.findAll('[data-testid="usage-top-session-bar"]')
    expect(bars[0].attributes('style')).toContain('width: 100%')
    expect(bars[1].attributes('style')).toContain('width: 50%')
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
    expect(w.find('[data-testid="usage-ledger"]').exists()).toBe(false)
    expect(w.find('svg.week-svg').exists()).toBe(false)
  })

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
})

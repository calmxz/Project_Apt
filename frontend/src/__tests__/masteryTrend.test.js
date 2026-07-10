import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MasteryTrend from '../components/profile/MasteryTrend.vue'

const weeks = (counts) =>
  counts.map((count, i) => ({
    week_start: `2026-0${Math.floor(i / 4) + 5}-0${(i % 4) * 7 + 1}`,
    count,
  }))

describe('MasteryTrend', () => {
  it('renders one column per week with height scaled to max', () => {
    const w = mount(MasteryTrend, {
      props: { weeklyMastery: weeks([0, 1, 2, 4, 0, 0, 0, 0, 0, 0, 0, 2]) },
    })
    const bars = w.findAll('.trend-bar')
    expect(bars).toHaveLength(12)
    expect(bars[3].attributes('style')).toContain('height: 100%')
    expect(bars[1].attributes('style')).toContain('height: 25%')
    expect(bars[0].attributes('style')).toContain('height: 0%')
  })

  it('shows hint instead of chart when all weeks are zero', () => {
    const w = mount(MasteryTrend, {
      props: { weeklyMastery: weeks(Array.from({ length: 12 }, () => 0)) },
    })
    expect(w.find('[data-testid="trend-empty"]').exists()).toBe(true)
    expect(w.find('.trend-chart').exists()).toBe(false)
  })

  it('exposes an aria-label summarizing totals', () => {
    const w = mount(MasteryTrend, {
      props: { weeklyMastery: weeks([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2]) },
    })
    expect(w.find('.trend-chart').attributes('aria-label')).toContain(
      '3 concepts mastered over the last 12 weeks',
    )
  })
})

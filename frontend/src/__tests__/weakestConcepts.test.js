import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import WeakestConcepts from '../components/profile/WeakestConcepts.vue'

const entry = (concept, accuracy, total = 4, results = [true, false]) => ({
  concept,
  correct_count: Math.round(accuracy * total),
  total_count: total,
  accuracy,
  last_results: results,
  first_seen_session_id: `sess-${concept}`,
})

const factory = (conceptAccuracy) =>
  mount(WeakestConcepts, {
    props: { conceptAccuracy },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('WeakestConcepts', () => {
  it('filters below two attempts, sorts ascending accuracy, caps at five', () => {
    const items = [
      entry('a', 0.9),
      entry('b', 0.1),
      entry('c', 0.5),
      entry('d', 0.3),
      entry('e', 0.7),
      entry('f', 0.2),
      entry('once', 0.0, 1), // single attempt: excluded
    ]
    const w = factory(items)
    const names = w.findAll('.rank-name').map((n) => n.text())
    expect(names).toEqual(['b', 'f', 'd', 'c', 'e'])
    expect(names).not.toContain('once')
  })

  it('renders sparkline dots oldest-to-newest with correct classes', () => {
    const w = factory([entry('a', 0.5, 4, [true, false, true])])
    const dots = w.findAll('.spark-dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].classes()).toContain('dot-correct')
    expect(dots[1].classes()).toContain('dot-wrong')
    expect(dots[2].classes()).toContain('dot-correct')
  })

  it('links each row to the first-seen session', () => {
    const w = factory([entry('a', 0.5)])
    const link = w.findComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({
      name: 'session-profile',
      params: { id: 'sess-a' },
    })
  })

  it('shows guidance copy when nothing has two attempts', () => {
    const w = factory([entry('once', 0.0, 1)])
    expect(w.find('[data-testid="weakest-empty"]').exists()).toBe(true)
    expect(w.find('.rank-row').exists()).toBe(false)
  })

  it('shows accuracy percent', () => {
    const w = factory([entry('a', 0.25)])
    expect(w.find('.rank-pct').text()).toBe('25%')
  })
})

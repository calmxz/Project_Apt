import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CheckRecap from '../components/chat/CheckRecap.vue'

const batch = (overrides = {}) => ({
  gap: 'glycolysis',
  total: 1,
  items: [
    {
      question: 'Which enzyme catalyzes the rate-limiting step?',
      options: ['PFK-1', 'Pyruvate kinase', 'Hexokinase'],
      status: 'answered',
      selectedIndex: 0,
      correctIndex: 0,
      correct: true,
      explanation: 'PFK-1 catalyzes the committed step.',
      ...overrides,
    },
  ],
})

describe('CheckRecap', () => {
  it('marks the chosen-correct option as your answer + correct', () => {
    const w = mount(CheckRecap, { props: { batch: batch() } })
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts[0].classes()).toContain('is-correct')
    expect(opts[0].text()).toMatch(/your answer/i)
  })

  it('marks wrong pick incorrect and the correct option correct', () => {
    const w = mount(CheckRecap, {
      props: { batch: batch({ selectedIndex: 1, correct: false }) },
    })
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts[1].classes()).toContain('is-incorrect')
    expect(opts[0].classes()).toContain('is-correct')
  })

  it('shows "answer not recorded" when selectedIndex is null', () => {
    const w = mount(CheckRecap, {
      props: { batch: batch({ selectedIndex: null, correct: null, status: 'answered' }) },
    })
    expect(w.text()).toMatch(/answer not recorded/i)
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts.some((o) => o.classes().includes('is-incorrect'))).toBe(false)
  })

  it('shows "answer not recorded" for a skipped item', () => {
    const w = mount(CheckRecap, {
      props: { batch: batch({ status: 'skipped', selectedIndex: null, correct: null }) },
    })
    expect(w.text()).toMatch(/answer not recorded/i)
    const opts = w.findAll('[data-testid="recap-option"]')
    expect(opts.some((o) => o.classes().includes('is-incorrect'))).toBe(false)
    // The correct option is still highlighted so the learner sees the answer.
    expect(opts[0].classes()).toContain('is-correct')
  })

  it('renders explanation and a score header', () => {
    const w = mount(CheckRecap, { props: { batch: batch() } })
    expect(w.text()).toContain('PFK-1 catalyzes the committed step.')
    expect(w.text()).toMatch(/1\s*\/\s*1/)
  })
})

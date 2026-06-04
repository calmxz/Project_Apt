import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CheckQuestion from '../components/chat/CheckQuestion.vue'

const base = {
  gap: 'atp', question: 'Net ATP per glucose?',
  options: ['2 ATP', '36 ATP', '0 ATP'], verdict: null,
}

describe('CheckQuestion (multiple choice)', () => {
  it('renders one button per option while unanswered', () => {
    const w = mount(CheckQuestion, { props: { check: { ...base } } })
    const opts = w.findAll('[data-testid="check-option"]')
    expect(opts).toHaveLength(3)
  })

  it('emits answer with the clicked index', async () => {
    const w = mount(CheckQuestion, { props: { check: { ...base } } })
    await w.findAll('[data-testid="check-option"]')[1].trigger('click')
    expect(w.emitted('answer')[0]).toEqual([1])
  })

  it('after answering: disables options, shows verdict + explanation', () => {
    const w = mount(CheckQuestion, {
      props: { check: { ...base, verdict: true, selectedIndex: 0, correctIndex: 0, explanation: 'Net 2 ATP.' } },
    })
    expect(w.find('[data-testid="check-verdict"]').text()).toContain('Correct')
    expect(w.text()).toContain('Net 2 ATP.')
    expect(w.findAll('[data-testid="check-option"]')[0].attributes('disabled')).toBeDefined()
  })

  it('emits skip when skip is clicked', async () => {
    const w = mount(CheckQuestion, { props: { check: { ...base } } })
    await w.find('[data-testid="check-skip"]').trigger('click')
    expect(w.emitted('skip')).toBeTruthy()
  })
})

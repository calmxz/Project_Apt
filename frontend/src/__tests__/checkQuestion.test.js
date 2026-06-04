import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CheckQuestion from '@/components/chat/CheckQuestion.vue'

describe('CheckQuestion', () => {
  it('renders the question and a Skip button while unanswered', () => {
    const w = mount(CheckQuestion, { props: { check: { gap: 'g', question: 'Inputs?', verdict: null } } })
    expect(w.text()).toContain('Inputs?')
    expect(w.find('[data-testid="check-skip"]').exists()).toBe(true)
  })

  it('shows a correct marker when verdict is true', () => {
    const w = mount(CheckQuestion, { props: { check: { gap: 'g', question: 'q?', verdict: true } } })
    expect(w.find('[data-testid="check-verdict"]').text().toLowerCase()).toContain('correct')
  })

  it('emits skip when the Skip button is clicked', async () => {
    const w = mount(CheckQuestion, { props: { check: { gap: 'g', question: 'q?', verdict: null } } })
    await w.find('[data-testid="check-skip"]').trigger('click')
    expect(w.emitted('skip')).toBeTruthy()
  })
})

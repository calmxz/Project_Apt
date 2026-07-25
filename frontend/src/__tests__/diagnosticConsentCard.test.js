import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DiagnosticConsentCard from '@/components/DiagnosticConsentCard.vue'

describe('DiagnosticConsentCard', () => {
  it('emits quiz when the quiz button is clicked', async () => {
    const w = mount(DiagnosticConsentCard)
    await w.get('[data-testid="diag-quiz"]').trigger('click')
    expect(w.emitted('quiz')).toHaveLength(1)
  })

  it('emits level with the chosen value', async () => {
    const w = mount(DiagnosticConsentCard)
    await w.get('[data-testid="diag-level-intermediate"]').trigger('click')
    expect(w.emitted('level')).toEqual([['intermediate']])
  })

  it('emits dismiss from the close button', async () => {
    const w = mount(DiagnosticConsentCard)
    await w.get('[data-testid="diag-dismiss"]').trigger('click')
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('disables action buttons while busy, but not dismiss', () => {
    const w = mount(DiagnosticConsentCard, { props: { busy: true } })
    expect(w.get('[data-testid="diag-quiz"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="diag-level-beginner"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="diag-dismiss"]').attributes('disabled')).toBeUndefined()
  })

  it('renders the error line only when error is set', () => {
    expect(mount(DiagnosticConsentCard).find('[role="alert"]').exists()).toBe(false)
    const w = mount(DiagnosticConsentCard, { props: { error: 'Could not save.' } })
    expect(w.get('[role="alert"]').text()).toBe('Could not save.')
  })
})

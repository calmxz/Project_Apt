import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Composer from '@/components/chat/Composer.vue'

describe('Composer lock', () => {
  it('shows a Skip button and an answer placeholder when locked', () => {
    const w = mount(Composer, { props: { modelValue: '', locked: true } })
    expect(w.find('[data-testid="composer-skip"]').exists()).toBe(true)
    expect(w.find('.composer-input').attributes('placeholder')).toMatch(/answer/i)
  })

  it('emits skip when the lock Skip button is clicked', async () => {
    const w = mount(Composer, { props: { modelValue: '', locked: true } })
    await w.find('[data-testid="composer-skip"]').trigger('click')
    expect(w.emitted('skip')).toBeTruthy()
  })

  it('does not show Skip when unlocked', () => {
    const w = mount(Composer, { props: { modelValue: '', locked: false } })
    expect(w.find('[data-testid="composer-skip"]').exists()).toBe(false)
  })
})

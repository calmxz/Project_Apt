import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import FeedbackStylePicker from '@/components/FeedbackStylePicker.vue'

const options = [
  { value: 'hints', label: 'Hints', sub: 'Nudge me toward the answer.' },
  { value: 'direct_answers', label: 'Direct answers', sub: 'Explain outright when I ask.' },
]

describe('FeedbackStylePicker', () => {
  it('renders one option per options entry', () => {
    const wrapper = mount(FeedbackStylePicker, {
      props: { modelValue: 'hints', options },
    })
    expect(wrapper.findAll('.radio-row')).toHaveLength(2)
    expect(wrapper.find('[data-testid="feedback-style-hints"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="feedback-style-direct_answers"]').exists()).toBe(true)
  })

  it('marks the modelValue option as selected', () => {
    const wrapper = mount(FeedbackStylePicker, {
      props: { modelValue: 'direct_answers', options },
    })
    const rows = wrapper.findAll('.radio-row')
    expect(rows[0].classes()).not.toContain('selected')
    expect(rows[1].classes()).toContain('selected')
    expect(wrapper.get('[data-testid="feedback-style-direct_answers"]').element.checked).toBe(true)
  })

  it('emits update:modelValue with the clicked option value', async () => {
    const wrapper = mount(FeedbackStylePicker, {
      props: { modelValue: 'hints', options },
    })
    await wrapper.get('[data-testid="feedback-style-direct_answers"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['direct_answers'])
  })

  it('renders the optional sub description when present, omits it otherwise', () => {
    const wrapper = mount(FeedbackStylePicker, {
      props: {
        modelValue: 'hints',
        options: [{ value: 'hints', label: 'Hints' }],
      },
    })
    expect(wrapper.find('.radio-sub').exists()).toBe(false)
    expect(wrapper.text()).toContain('Hints')
  })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '@/components/EmptyState.vue'

describe('EmptyState a11y — heading level (S1)', () => {
  it('renders the headline as a level-2 heading', () => {
    const wrapper = mount(EmptyState, { props: { headline: 'Nothing here yet' } })
    const heading = wrapper.find('h2.empty-headline')
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBe('Nothing here yet')
    expect(wrapper.find('h3').exists()).toBe(false)
  })
})

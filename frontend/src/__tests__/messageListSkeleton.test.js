import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageListSkeleton from '@/components/chat/MessageListSkeleton.vue'

describe('MessageListSkeleton', () => {
  it('renders the requested number of placeholder rows and is aria-hidden', () => {
    const wrapper = mount(MessageListSkeleton, { props: { count: 3 } })
    const root = wrapper.find('[data-testid="session-messages-skeleton"]')
    expect(root.exists()).toBe(true)
    expect(root.attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('.msg-skel-row')).toHaveLength(3)
  })

  it('defaults to a sensible row count', () => {
    const wrapper = mount(MessageListSkeleton)
    expect(wrapper.findAll('.msg-skel-row').length).toBeGreaterThan(0)
  })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UserBubble from '../components/chat/UserBubble.vue'

describe('UserBubble', () => {
  it('renders message content text', () => {
    const w = mount(UserBubble, { props: { content: 'Hi there' } })
    expect(w.html()).toContain('Hi there')
  })

  it('renders markdown — bold text becomes <strong>', () => {
    const w = mount(UserBubble, { props: { content: '**bold** here' } })
    expect(w.html()).toContain('<strong>bold</strong>')
  })

  it('root element has class msg and user', () => {
    const w = mount(UserBubble, { props: { content: 'test' } })
    expect(w.classes()).toContain('msg')
    expect(w.classes()).toContain('user')
  })

  it('root element has data-testid="msg-user"', () => {
    const w = mount(UserBubble, { props: { content: 'test' } })
    expect(w.attributes('data-testid')).toBe('msg-user')
  })

  it('role-tag reads "you"', () => {
    const w = mount(UserBubble, { props: { content: 'hello' } })
    expect(w.find('.role-tag').text()).toBe('you')
  })

  it('renders with empty content without throwing', () => {
    const w = mount(UserBubble, { props: { content: '' } })
    expect(w.exists()).toBe(true)
  })

  it('renders with default prop (no content supplied)', () => {
    const w = mount(UserBubble)
    expect(w.exists()).toBe(true)
    expect(w.find('.role-tag').text()).toBe('you')
  })
})

import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SessionHeader from '../components/chat/SessionHeader.vue'

const mountHeader = (props) =>
  mount(SessionHeader, {
    props,
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('SessionHeader', () => {
  it('renders the topic text', () => {
    const wrapper = mountHeader({ topic: 'Glycolysis pathway', sessionId: 's1' })
    expect(wrapper.text()).toContain('Glycolysis pathway')
  })

  it('links the title to the session profile page', () => {
    const wrapper = mountHeader({ topic: 'Glycolysis pathway', sessionId: 's1' })
    const link = wrapper.findComponent(RouterLinkStub)
    expect(link.exists()).toBe(true)
    expect(link.props('to')).toBe('/session/s1/profile')
    expect(link.text()).toContain('Glycolysis pathway')
  })

  it('renders a non-link title when no sessionId is given', () => {
    const wrapper = mountHeader({ topic: 'Glycolysis pathway', sessionId: '' })
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false)
    expect(wrapper.text()).toContain('Glycolysis pathway')
  })

  it('renders nothing when topic is empty', () => {
    const wrapper = mountHeader({ topic: '', sessionId: 's1' })
    expect(wrapper.find('[data-testid="session-header"]').exists()).toBe(false)
  })
})

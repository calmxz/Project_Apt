import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ChatHeader from '@/components/chat/ChatHeader.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const stubs = {
  Button: {
    props: ['disabled', 'label'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
  },
  RouterLink: { template: '<a><slot /></a>' },
}

function mountHeader(props) {
  return mount(ChatHeader, { props, global: { stubs } })
}

describe('ChatHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the session topic', () => {
    const wrapper = mountHeader({
      session: { id: 's1', topic: 'Algorithms', ended_at: null },
      id: 's1',
    })
    expect(wrapper.text()).toContain('Algorithms')
  })

  it('shows "in session" folio when not ended', () => {
    const wrapper = mountHeader({
      session: { id: 's1', topic: 'Algorithms', ended_at: null },
      id: 's1',
    })
    expect(wrapper.find('.folio').text()).toBe('in session')
  })

  it('shows "archived" folio when ended_at is set', () => {
    const wrapper = mountHeader({
      session: { id: 's1', topic: 'Algorithms', ended_at: '2026-05-01T10:00:00Z' },
      id: 's1',
    })
    expect(wrapper.find('.folio').text()).toBe('archived')
  })

  it('emits end-session when End session button is clicked', async () => {
    const wrapper = mountHeader({
      session: { id: 's1', topic: 'Algorithms', ended_at: null },
      id: 's1',
    })
    await wrapper.get('[data-testid="session-end"]').trigger('click')
    expect(wrapper.emitted('end-session')).toBeTruthy()
  })

  it('End button is absent when ended_at is set', () => {
    const wrapper = mountHeader({
      session: { id: 's1', topic: 'Algorithms', ended_at: '2026-05-01T10:00:00Z' },
      id: 's1',
    })
    expect(wrapper.find('[data-testid="session-end"]').exists()).toBe(false)
  })

  it('profile link is present', () => {
    const wrapper = mountHeader({
      session: { id: 's1', topic: 'Algorithms', ended_at: null },
      id: 's1',
    })
    expect(wrapper.find('[data-testid="session-profile-link"]').exists()).toBe(true)
  })

  it('renders with a null session during load and disables End', () => {
    const wrapper = mountHeader({ session: null, id: 's1' })
    expect(wrapper.find('.topic').text()).toBe('Session')
    const end = wrapper.find('[data-testid="session-end"]')
    expect(end.exists()).toBe(true)
    expect(end.attributes('disabled')).toBeDefined()
  })
})

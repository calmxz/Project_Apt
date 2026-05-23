import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import NewSessionView from '@/views/NewSessionView.vue'
import { useSessionStore } from '@/stores/session.js'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const stubs = {
  BackButton: { template: '<button data-testid="back" />' },
}

function mountView() {
  return mount(NewSessionView, { global: { stubs } })
}

describe('NewSessionView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
  })

  it('renders hero copy and quick picks', () => {
    const wrapper = mountView()
    expect(wrapper.text()).toContain('What do you want to learn?')
    expect(wrapper.text()).toContain('Recursion')
    expect(wrapper.text()).toContain('CSS grid')
  })

  it('submit disabled when topic empty', () => {
    const wrapper = mountView()
    const btn = wrapper.get('[data-testid="new-submit"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('typing a topic enables submit', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    expect(
      wrapper.get('[data-testid="new-submit"]').attributes('disabled'),
    ).toBeUndefined()
  })

  it('clicking a quick pick fills topic', async () => {
    const wrapper = mountView()
    await wrapper.findAll('.quick-pick')[0].trigger('click')
    expect(wrapper.get('[data-testid="new-topic"]').element.value).toBe(
      'Recursion',
    )
  })

  it('lists sessions on mount when none cached', async () => {
    const store = useSessionStore()
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(listSpy).toHaveBeenCalledWith()
  })

  it('skips listSessions when store already has sessions', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', ended_at: null, created_at: new Date().toISOString() },
    ]
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('warns + offers open when active session on topic exists', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'sess-123', topic: 'Calculus', ended_at: null, created_at: new Date().toISOString() },
    ]
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    expect(wrapper.find('[data-testid="new-active-warn"]').exists()).toBe(true)
    expect(
      wrapper.get('[data-testid="new-submit"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('open existing routes to that session', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'sess-abc', topic: 'Calculus', ended_at: null, created_at: new Date().toISOString() },
    ]
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-open-existing"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'sess-abc' } })
  })

  it('submit creates session and routes to it', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-1' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-submit"]').trigger('click')
    await flushPromises()
    expect(store.createSession).toHaveBeenCalledWith({
      topic: 'Calculus',
      seedMode: 'fresh',
      priorSessionId: null,
    })
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-1' } })
  })

  it('submit shows error on createSession rejection', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'createSession').mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="new-error"]').text()).toBe('boom')
  })

  it('enter key submits when valid', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-2' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-topic"]').trigger('keydown.enter')
    await flushPromises()
    expect(store.createSession).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-2' } })
  })
})

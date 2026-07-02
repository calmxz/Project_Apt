import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from '@/views/HomeView.vue'
import { useSessionStore } from '@/stores/session.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const apiEndSession = vi.fn()
vi.mock('@/services/sessionsApi.js', () => ({
  endSession: (...args) => apiEndSession(...args),
}))

const apiAggregate = vi.fn()
vi.mock('@/services/profileApi.js', () => ({
  getAggregateProfile: (...args) => apiAggregate(...args),
}))

const stubs = {
  EmptyState: {
    props: ['tone', 'eyebrow', 'headline', 'subtext'],
    template: '<div data-testid="empty-stub"><slot name="subtext" /><slot name="cta" /></div>',
  },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

function makeSession(id, topic, ended = false, createdOffset = 0) {
  const created = new Date(Date.now() + createdOffset).toISOString()
  return {
    id,
    topic,
    created_at: created,
    ended_at: ended ? created : null,
  }
}

function mountView() {
  return mount(HomeView, { global: { stubs } })
}

describe('HomeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    apiEndSession.mockReset()
    apiAggregate.mockReset()
    apiAggregate.mockResolvedValue({ recent_topics: [] })
  })

  it('calls listSessions on mount', async () => {
    const store = useSessionStore()
    const spy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(spy).toHaveBeenCalledWith()
  })

  it('shows loading state', () => {
    const store = useSessionStore()
    store.loading = true
    const wrapper = mountView()
    expect(wrapper.text()).toContain('Loading')
  })

  it('shows error from store', () => {
    const store = useSessionStore()
    store.error = 'list failed'
    const wrapper = mountView()
    expect(wrapper.get('[data-testid="home-error"]').text()).toBe('list failed')
  })

  it('shows a single New lesson card, no Build a subject', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('New lesson')
    expect(wrapper.text()).not.toContain('Build a subject')
    expect(wrapper.find('[data-testid="home-mode-quick"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-mode-subject"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-build-start"]').exists()).toBe(false)
  })

  it('New lesson creates a session then navigates', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'sess1' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-quick-topic"]').setValue('Recursion')
    await wrapper.get('[data-testid="home-quick-go"]').trigger('click')
    await flushPromises()
    expect(store.createSession).toHaveBeenCalledWith({ topic: 'Recursion', seedMode: 'fresh', priorSessionId: null })
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'sess1' } })
  })

  it('does not render the dupe banner or recent feed (relocated)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Calc', false, -1), makeSession('a2', 'Calc', false, 0)]
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-dupe-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-recent"]').exists()).toBe(false)
  })
})

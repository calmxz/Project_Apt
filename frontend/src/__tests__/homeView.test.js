import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from '@/views/HomeView.vue'
import { useSessionStore } from '@/stores/session.js'
import { useUserStore } from '@/stores/user.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))

const apiEndSession = vi.fn()
vi.mock('@/services/sessionsApi.js', () => ({
  endSession: (...args) => apiEndSession(...args),
}))

const stubs = {
  EmptyState: {
    props: ['tone', 'eyebrow', 'headline', 'subtext'],
    template: '<div><slot name="subtext" /><slot name="cta" /></div>',
  },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
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
    const user = useUserStore()
    user.userId = 'u1'
  })

  it('calls listSessions on mount when userId present', async () => {
    const store = useSessionStore()
    const spy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('u1')
  })

  it('skips listSessions when no userId', async () => {
    const user = useUserStore()
    user.userId = null
    const store = useSessionStore()
    const spy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    mountView()
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
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

  it('empty active state when no sessions', () => {
    vi.spyOn(useSessionStore(), 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="home-empty-active"]').exists()).toBe(true)
  })

  it('active tab renders one row per active session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Calculus'), makeSession('a2', 'Algebra')]
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-row-active-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-row-active-a2"]').exists()).toBe(true)
  })

  it('switches to ended tab and renders ended rows', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('e1', 'Old topic', true)]
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-tab-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="home-row-ended-e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-resume-e1"]').exists()).toBe(true)
  })

  it('shows empty ended state when no ended sessions', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Calculus')]
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-tab-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="home-empty-ended"]').exists()).toBe(true)
  })

  it('new session button routes to new-session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-new-session"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'new-session' })
  })

  it('resume invokes reopenSession then routes to session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue()
    store.sessions = [makeSession('e1', 'Topic', true)]
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-tab-ended"]').trigger('click')
    await wrapper.get('[data-testid="home-resume-e1"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('e1', 'u1')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
  })

  it('resume failure still clears resumingId state', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'reopenSession').mockRejectedValue(new Error('boom'))
    store.sessions = [makeSession('e1', 'Topic', true)]
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-tab-ended"]').trigger('click')
    await wrapper.get('[data-testid="home-resume-e1"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
    const resumeBtn = wrapper.get('[data-testid="home-resume-e1"]')
    expect(resumeBtn.attributes('disabled')).toBeUndefined()
  })

  it('duplicate banner appears when two active sessions share topic', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [
      makeSession('a1', 'Calculus', false, -10000),
      makeSession('a2', 'Calculus', false, 0),
    ]
    const wrapper = mountView()
    await flushPromises()
    const banner = wrapper.get('[data-testid="home-dupe-banner"]')
    expect(banner.text()).toContain('1 duplicate active session')
  })

  it('cleanupDuplicates ends older dupes and re-lists', async () => {
    const store = useSessionStore()
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    apiEndSession.mockResolvedValue({})
    store.sessions = [
      makeSession('older', 'Calculus', false, -10000),
      makeSession('newer', 'Calculus', false, 0),
    ]
    const wrapper = mountView()
    await flushPromises()
    listSpy.mockClear()
    await wrapper.get('[data-testid="home-dupe-cleanup"]').trigger('click')
    await flushPromises()
    expect(apiEndSession).toHaveBeenCalledWith('older', 'u1')
    expect(apiEndSession).not.toHaveBeenCalledWith('newer', 'u1')
    expect(listSpy).toHaveBeenCalledWith('u1')
  })

  it('cleanupDuplicates sets store.error on failure', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const setErrorSpy = vi.spyOn(store, 'setError')
    apiEndSession.mockRejectedValue(new Error('end failed'))
    store.sessions = [
      makeSession('older', 'Calculus', false, -10000),
      makeSession('newer', 'Calculus', false, 0),
    ]
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-dupe-cleanup"]').trigger('click')
    await flushPromises()
    expect(setErrorSpy).toHaveBeenCalledWith('end failed')
  })
})

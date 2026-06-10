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

function makeRecent(id, topic, { ended = false, summary = null, createdOffset = 0 } = {}) {
  const created = new Date(Date.now() + createdOffset).toISOString()
  return {
    id,
    topic,
    created_at: created,
    ended_at: ended ? created : null,
    last_session_summary: summary,
  }
}

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

  it('lede shows zero-session welcome when no sessions', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-lede"]').text()).toContain(
      'A study session is one conversation',
    )
  })

  it('lede shows active count and points to sidebar when sessions exist', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Calculus')]
    const wrapper = mountView()
    await flushPromises()
    const lede = wrapper.get('[data-testid="home-lede"]').text()
    expect(lede).toContain('1 active session')
    expect(lede).toContain('Pick one from the sidebar')
  })

  it('lede pluralises when multiple active sessions', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [
      makeSession('a1', 'Calculus'),
      makeSession('a2', 'Algebra'),
    ]
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-lede"]').text()).toContain('2 active sessions')
  })

  it('empty state renders when zero sessions (active or ended)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-empty-active"]').exists()).toBe(true)
  })

  it('empty state does not render when ended sessions exist', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('e1', 'Topic', true)]
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-empty-active"]').exists()).toBe(false)
  })

  it('new session button routes to new-session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-new-session"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'new-session' })
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
    expect(apiEndSession).toHaveBeenCalledWith('older')
    expect(apiEndSession).not.toHaveBeenCalledWith('newer')
    expect(listSpy).toHaveBeenCalledWith()
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

  it('does not render tile grid or tabs (sidebar owns the list now)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Calculus')]
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-row-active-a1"]').exists()).toBe(false)
    expect(wrapper.find('.tile-grid').exists()).toBe(false)
  })

  it('renders one feed row per recent topic', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('a1', 'Trees', { createdOffset: 0 }),
        makeRecent('e1', 'Big-O', { ended: true, summary: 'Covered amortized analysis.', createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="home-recent-"]').length).toBe(2)
  })

  it('orders active rows before ended rows', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('e1', 'Big-O', { ended: true, summary: 'done', createdOffset: 0 }),
        makeRecent('a1', 'Trees', { createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    const rows = wrapper.findAll('[data-testid^="home-recent-"]')
    expect(rows[0].attributes('data-testid')).toBe('home-recent-a1')
    expect(rows[1].attributes('data-testid')).toBe('home-recent-e1')
  })

  it('strips the [auto] prefix from the snippet', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('e1', 'Big-O', true)]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('e1', 'Big-O', { ended: true, summary: '[auto] user: hi; assistant: yo' }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    const text = wrapper.get('[data-testid="home-recent-e1"]').text()
    expect(text).not.toContain('[auto]')
    expect(text).toContain('user: hi')
  })

  it('Enter on Continue does not bubble to row navigation', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'reopenSession').mockResolvedValue({})
    store.sessions = [makeSession('e1', 'Big-O', true)]
    apiAggregate.mockResolvedValue({
      recent_topics: [makeRecent('e1', 'Big-O', { ended: true, summary: 'done' })],
    })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-continue-e1"]').trigger('keydown.enter')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows summary snippet when present and fallback when null', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('e1', 'Big-O', { ended: true, summary: 'Covered amortized analysis.' }),
        makeRecent('a1', 'Trees', { createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-recent-e1"]').text()).toContain('Covered amortized analysis.')
    expect(wrapper.get('[data-testid="home-recent-a1"]').text()).toContain('No activity yet')
  })

  it('clicking a feed row navigates to the session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({ recent_topics: [makeRecent('a1', 'Trees')] })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-recent-a1"] .recent-link').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a1' } })
  })

  it('ended row shows Continue; active row does not', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('a1', 'Trees'),
        makeRecent('e1', 'Big-O', { ended: true, summary: 'done', createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-continue-e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-continue-a1"]').exists()).toBe(false)
  })

  it('Continue reopens then navigates, without double-firing row navigation', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue({})
    store.sessions = [makeSession('e1', 'Big-O', true)]
    apiAggregate.mockResolvedValue({
      recent_topics: [makeRecent('e1', 'Big-O', { ended: true, summary: 'done' })],
    })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-continue-e1"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('e1')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('no feed when zero sessions (EmptyState only)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-recent"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-empty-active"]').exists()).toBe(true)
  })

  function makeRichRecent(id, over = {}) {
    return {
      id, topic: 'Glycolysis', created_at: new Date().toISOString(), ended_at: null,
      last_session_summary: null, message_count: 4,
      last_activity_at: new Date().toISOString(), last_message_preview: null,
      progress: { focus_target_gap: 'ATP yield', mastered_count: 0 }, ...over,
    }
  }

  it('renders the layered card description (focus tier)', async () => {
    apiAggregate.mockResolvedValue({ recent_topics: [makeRichRecent('r1')] })
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-recent-r1"]').text()).toContain('Focus: ATP yield')
  })

  it('shows a "View all sessions" link to /sessions when sessions exist', async () => {
    apiAggregate.mockResolvedValue({ recent_topics: [makeRichRecent('r1')] })
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeRichRecent('r1')]
    const wrapper = mountView()
    await flushPromises()
    const link = wrapper.get('[data-testid="home-view-all"]')
    expect(link.attributes('to') || link.attributes('href')).toContain('/sessions')
  })
})

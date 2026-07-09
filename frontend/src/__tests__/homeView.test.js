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

const apiReviewQueue = vi.fn()
vi.mock('@/services/reviewApi.js', () => ({
  getReviewQueue: (...args) => apiReviewQueue(...args),
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

function makeReviewItem(concept, overrides = {}) {
  return {
    concept,
    source_session_id: 's1',
    source_topic: 'biology',
    last_tested_at: '2026-07-01T00:00:00Z',
    streak: 1,
    due_at: '2026-07-02T00:00:00Z',
    ...overrides,
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
    apiReviewQueue.mockReset()
    apiReviewQueue.mockResolvedValue({ items: [], total: 0, limit: 3, offset: 0 })
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

describe('HomeView review card', () => {
  beforeEach(() => {
    push.mockClear()
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
  })

  it('hides the card when nothing is due', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-mode-review"]').exists()).toBe(false)
  })

  it('renders count and items when concepts are due', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis'), makeReviewItem('osmosis')],
      total: 2, limit: 3, offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-mode-review"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="home-review-count"]').text()).toContain('2 concepts')
    expect(wrapper.findAll('[data-testid="home-review-item"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('mitosis')
  })

  it('hides the card when the queue fetch fails', async () => {
    apiReviewQueue.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-mode-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-error"]').exists()).toBe(false)
  })

  it('shows View all only when total exceeds the shown items', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('a'), makeReviewItem('b'), makeReviewItem('c')],
      total: 5, limit: 3, offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-review-more"]').text()).toContain('5')
  })

  it('starts a review via continueTopic and navigates with review_gap query', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis', { source_session_id: 'src9', source_topic: 'cells' })],
      total: 1, limit: 3, offset: 0,
    })
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'newsess' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-review-item"]').trigger('click')
    await flushPromises()
    expect(store.continueTopic).toHaveBeenCalledWith({ id: 'src9', topic: 'cells' })
    expect(push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'newsess' },
      query: { review_gap: 'mitosis' },
    })
  })

  it('stays on Home when continueTopic fails', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis')], total: 1, limit: 3, offset: 0,
    })
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-review-item"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('View all refetches with a large limit and hides itself', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('a'), makeReviewItem('b'), makeReviewItem('c')],
      total: 5, limit: 3, offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    apiReviewQueue.mockResolvedValue({
      items: ['a', 'b', 'c', 'd', 'e'].map((c) => makeReviewItem(c)),
      total: 5, limit: 100, offset: 0,
    })
    await wrapper.get('[data-testid="home-review-more"]').trigger('click')
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenLastCalledWith({ limit: 100, offset: 0 })
    expect(wrapper.findAll('[data-testid="home-review-item"]')).toHaveLength(5)
    expect(wrapper.find('[data-testid="home-review-more"]').exists()).toBe(false)
  })
})

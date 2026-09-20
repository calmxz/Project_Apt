import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ReviewView from '@/views/ReviewView.vue'
import { useSessionStore } from '@/stores/session.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const apiReviewQueue = vi.fn()
vi.mock('@/services/reviewApi.js', () => ({
  getReviewQueue: (...args) => apiReviewQueue(...args),
}))

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

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  BackButton: { template: '<a data-testid="back-button" />' },
}

function mountView() {
  return mount(ReviewView, {
    global: { stubs },
  })
}

describe('ReviewView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    apiReviewQueue.mockReset()
    apiReviewQueue.mockResolvedValue({ items: [], total: 0, limit: 3, offset: 0 })
  })

  it('loads the queue silently on mount', async () => {
    mountView()
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenCalledWith({ limit: 3, offset: 0 }, { silent: true })
  })

  it('shows the empty state when nothing is due', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="review-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-item"]').exists()).toBe(false)
  })

  // D-11: a failed fetch is not an empty queue. The page never blocks, but it
  // says which of the three states it is in and offers a retry.
  it('shows an error row with a retry when the fetch fails (never blocks)', async () => {
    apiReviewQueue.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="review-empty"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="review-error"]').text()).toContain(
      'Could not load your review queue.',
    )
    expect(wrapper.find('[data-testid="review-retry"]').exists()).toBe(true)
  })

  it('shows a skeleton while the first load is in flight and drops it after', async () => {
    let resolveQueue
    apiReviewQueue.mockImplementation(
      () =>
        new Promise((res) => {
          resolveQueue = res
        }),
    )
    const wrapper = mountView()
    await nextTick()
    expect(wrapper.find('[data-testid="review-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-empty"]').exists()).toBe(false)
    resolveQueue({ items: [], total: 0, limit: 3, offset: 0 })
    await flushPromises()
    expect(wrapper.find('[data-testid="review-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-empty"]').exists()).toBe(true)
  })

  it('Retry refetches silently and renders the queue on success', async () => {
    apiReviewQueue.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis')],
      total: 1,
      limit: 3,
      offset: 0,
    })
    await wrapper.get('[data-testid="review-retry"]').trigger('click')
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenLastCalledWith({ limit: 3, offset: 0 }, { silent: true })
    expect(wrapper.find('[data-testid="review-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="review-item"]')).toHaveLength(1)
  })

  it('renders count and items when concepts are due', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis'), makeReviewItem('osmosis')],
      total: 2,
      limit: 3,
      offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="review-count"]').text()).toContain('2 concepts')
    expect(wrapper.findAll('[data-testid="review-item"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('mitosis')
  })

  it('shows View all only when total exceeds the shown items', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('a'), makeReviewItem('b'), makeReviewItem('c')],
      total: 5,
      limit: 3,
      offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="review-more"]').text()).toContain('5')
  })

  it('starts a review via continueTopic and navigates with review_gap query', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis', { source_session_id: 'src9', source_topic: 'cells' })],
      total: 1,
      limit: 3,
      offset: 0,
    })
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'newsess' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="review-item"]').trigger('click')
    await flushPromises()
    expect(store.continueTopic).toHaveBeenCalledWith({ id: 'src9', topic: 'cells' })
    expect(push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'newsess' },
      query: { review_gap: 'mitosis' },
    })
  })

  it('stays put when continueTopic resolves empty', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis')],
      total: 1,
      limit: 3,
      offset: 0,
    })
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="review-item"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('swallows a rejecting continueTopic and resets busy (F-45)', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('mitosis')],
      total: 1,
      limit: 3,
      offset: 0,
    })
    const store = useSessionStore()
    const continueSpy = vi.spyOn(store, 'continueTopic').mockRejectedValue(new Error('boom'))
    continueSpy.mockClear()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="review-item"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="review-item"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="review-item"]').trigger('click')
    await flushPromises()
    expect(continueSpy).toHaveBeenCalledTimes(2)
  })

  it('View all refetches with a large limit and hides itself', async () => {
    apiReviewQueue.mockResolvedValue({
      items: [makeReviewItem('a'), makeReviewItem('b'), makeReviewItem('c')],
      total: 5,
      limit: 3,
      offset: 0,
    })
    const wrapper = mountView()
    await flushPromises()
    apiReviewQueue.mockResolvedValue({
      items: ['a', 'b', 'c', 'd', 'e'].map((c) => makeReviewItem(c)),
      total: 5,
      limit: 100,
      offset: 0,
    })
    await wrapper.get('[data-testid="review-more"]').trigger('click')
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenLastCalledWith({ limit: 100, offset: 0 })
    expect(wrapper.findAll('[data-testid="review-item"]')).toHaveLength(5)
    expect(wrapper.find('[data-testid="review-more"]').exists()).toBe(false)
  })

  it('labels the streak in plain words and renders a back control', async () => {
    apiReviewQueue.mockResolvedValue({
      total: 1,
      items: [makeReviewItem('ATP yield', { streak: 2 })],
    })
    const w = mount(ReviewView, { global: { stubs } })
    await flushPromises()
    // Redesign C1: the row is a Cornell recitation pair -- the cue button
    // (review-item) carries the concept, and the streak sits in the covered
    // answer cell beside it. Same copy, asserted on the row that holds both.
    expect(w.get('[data-testid="review-row"]').text()).toContain('2 correct in a row')
    expect(w.text()).not.toMatch(/streak \d/)
    expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
  })
})

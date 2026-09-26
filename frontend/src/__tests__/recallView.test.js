import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import RecallView from '@/views/RecallView.vue'
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

function queueOf(items) {
  return { items, total: items.length, limit: 100, offset: 0 }
}

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  BackButton: { template: '<a data-testid="back-button" />' },
}

function mountView() {
  return mount(RecallView, {
    global: { stubs },
  })
}

describe('RecallView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    apiReviewQueue.mockReset()
    apiReviewQueue.mockResolvedValue(queueOf([]))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads the whole queue silently on mount', async () => {
    mountView()
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenCalledTimes(1)
    expect(apiReviewQueue).toHaveBeenCalledWith({ limit: 100, offset: 0 }, { silent: true })
  })

  it('titles the page Recall and renders a back control', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Recall')
    expect(wrapper.get('.lede').text()).toContain('recall')
    expect(wrapper.find('[data-testid="back-button"]').exists()).toBe(true)
  })

  it('shows the empty divider when nothing is due', async () => {
    const wrapper = mountView()
    await flushPromises()
    const empty = wrapper.get('[data-testid="recall-empty"]')
    expect(empty.get('[data-testid="recall-tab"]').text()).toBe('Nothing due')
    expect(empty.text()).toContain(
      'No divider has a concept due. Finish a session and its concepts file themselves here when a check comes round.',
    )
    expect(empty.get('a').attributes('href')).toBe('/')
    expect(empty.get('a').text()).toBe('Back home')
    expect(wrapper.find('[data-testid="recall-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="recall-count"]').exists()).toBe(false)
  })

  // D-11: a failed fetch is not an empty queue. The page never blocks, but it
  // says which of the three states it is in and offers a retry.
  it('shows an error row with a retry when the fetch fails (never blocks)', async () => {
    apiReviewQueue.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="recall-empty"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="recall-error"]').text()).toContain(
      'Could not load your recall queue.',
    )
    expect(wrapper.find('[data-testid="recall-retry"]').exists()).toBe(true)
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
    expect(wrapper.find('[data-testid="recall-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="recall-empty"]').exists()).toBe(false)
    resolveQueue(queueOf([]))
    await flushPromises()
    expect(wrapper.find('[data-testid="recall-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="recall-empty"]').exists()).toBe(true)
  })

  it('Retry refetches the whole queue silently and renders it on success', async () => {
    apiReviewQueue.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()
    apiReviewQueue.mockResolvedValue(queueOf([makeReviewItem('mitosis')]))
    await wrapper.get('[data-testid="recall-retry"]').trigger('click')
    await flushPromises()
    expect(apiReviewQueue).toHaveBeenLastCalledWith({ limit: 100, offset: 0 }, { silent: true })
    expect(wrapper.find('[data-testid="recall-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="recall-card"]')).toHaveLength(1)
  })

  it('renders one divider per source session in queue order', async () => {
    apiReviewQueue.mockResolvedValue(
      queueOf([
        makeReviewItem('calvin cycle', { source_session_id: 's1', source_topic: 'Photosynthesis' }),
        makeReviewItem('squeeze theorem', { source_session_id: 's2', source_topic: 'Limits' }),
        makeReviewItem('stomata', { source_session_id: 's1', source_topic: 'Photosynthesis' }),
      ]),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="recall-count"]').text()).toContain('3 concepts')
    const dividers = wrapper.findAll('[data-testid="recall-divider"]')
    expect(dividers).toHaveLength(2)
    expect(dividers[0].get('[data-testid="recall-tab"]').text()).toContain('Photosynthesis')
    expect(dividers[0].get('[data-testid="recall-tab"]').text()).toContain('2 due')
    expect(dividers[1].get('[data-testid="recall-tab"]').text()).toContain('Limits')
    expect(dividers[1].get('[data-testid="recall-tab"]').text()).toContain('1 due')
    expect(
      dividers[0].findAll('[data-testid="recall-card"]').map((c) => c.find('.card-concept').text()),
    ).toEqual(['calvin cycle', 'stomata'])
  })

  it('writes due-since, concept and streak in words on each card', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-05T00:00:00Z'))
    apiReviewQueue.mockResolvedValue(
      queueOf([
        makeReviewItem('ATP yield', { streak: 2 }),
        makeReviewItem('osmosis', { streak: 0 }),
      ]),
    )
    const wrapper = mountView()
    await flushPromises()
    const cards = wrapper.findAll('[data-testid="recall-card"]')
    expect(cards[0].text()).toContain('due 3 days ago')
    expect(cards[0].text()).toContain('ATP yield')
    expect(cards[0].text()).toContain('2 correct in a row')
    expect(cards[1].text()).toContain('not yet held')
    expect(wrapper.text()).not.toMatch(/streak \d/)
  })

  it('has no View all split: every item fetched is on the page', async () => {
    apiReviewQueue.mockResolvedValue(
      queueOf(['a', 'b', 'c', 'd', 'e'].map((c) => makeReviewItem(c))),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="recall-card"]')).toHaveLength(5)
    expect(wrapper.text()).not.toContain('View all')
  })

  it('a card starts a review via continueTopic and navigates with review_gap', async () => {
    apiReviewQueue.mockResolvedValue(
      queueOf([makeReviewItem('mitosis', { source_session_id: 'src9', source_topic: 'cells' })]),
    )
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'newsess' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="recall-card"]').trigger('click')
    await flushPromises()
    expect(store.continueTopic).toHaveBeenCalledWith({ id: 'src9', topic: 'cells' })
    expect(push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'newsess' },
      query: { review_gap: 'mitosis' },
    })
  })

  it('"Check <topic> now" starts the most overdue concept in that divider', async () => {
    apiReviewQueue.mockResolvedValue(
      queueOf([
        makeReviewItem('calvin cycle', { source_session_id: 's1', source_topic: 'Photosynthesis' }),
        makeReviewItem('squeeze theorem', { source_session_id: 's2', source_topic: 'Limits' }),
        makeReviewItem('epsilon-delta', { source_session_id: 's2', source_topic: 'Limits' }),
      ]),
    )
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'newsess' })
    const wrapper = mountView()
    await flushPromises()
    const check = wrapper.findAll('[data-testid="recall-check-group"]')[1]
    expect(check.text()).toContain('Check Limits now')
    expect(check.text()).toContain('starts with squeeze theorem')
    await check.trigger('click')
    await flushPromises()
    expect(store.continueTopic).toHaveBeenCalledWith({ id: 's2', topic: 'Limits' })
    expect(push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'newsess' },
      query: { review_gap: 'squeeze theorem' },
    })
  })

  it('stays put when continueTopic resolves empty', async () => {
    apiReviewQueue.mockResolvedValue(queueOf([makeReviewItem('mitosis')]))
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="recall-card"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
  })

  it('swallows a rejecting continueTopic and resets busy (F-45)', async () => {
    apiReviewQueue.mockResolvedValue(queueOf([makeReviewItem('mitosis')]))
    const store = useSessionStore()
    const continueSpy = vi.spyOn(store, 'continueTopic').mockRejectedValue(new Error('boom'))
    continueSpy.mockClear()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="recall-card"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="recall-card"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="recall-card"]').trigger('click')
    await flushPromises()
    expect(continueSpy).toHaveBeenCalledTimes(2)
  })
})

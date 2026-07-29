import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
let mockRouteQuery = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: mockRouteQuery }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

vi.mock('@/services/sessionsApi.js', () => ({ getSessionLibrary: vi.fn() }))

import SessionsLibraryView from '@/views/SessionsLibraryView.vue'
import * as sessionsApi from '@/services/sessionsApi.js'

const stubs = {
  EmptyState: { template: '<div data-testid="empty-stub"><slot name="cta" /></div>' },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

function page(items, over = {}) {
  return { items, total: items.length, limit: 20, offset: 0, ...over }
}
function item(id, over = {}) {
  return {
    id,
    topic: `Topic ${id}`,
    created_at: '2026-06-01T00:00:00Z',
    ended_at: null,
    message_count: 2,
    last_activity_at: '2026-06-01T00:00:00Z',
    last_message_preview: null,
    last_session_summary: null,
    progress: { focus_target_gap: 'gap-' + id, mastered_count: 0 },
    ...over,
  }
}

class MockIntersectionObserver {
  static instances = []
  constructor(cb, options) {
    this.cb = cb
    this.options = options
    this.observed = new Set()
    MockIntersectionObserver.instances.push(this)
  }
  observe(el) {
    this.observed.add(el)
  }
  unobserve(el) {
    this.observed.delete(el)
  }
  disconnect() {
    this.observed.clear()
  }
  trigger(isIntersecting = true) {
    this.cb([{ isIntersecting }])
  }
}

describe('SessionsLibraryView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    sessionsApi.getSessionLibrary.mockReset()
    mockRouteQuery = {}
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  it('renders rich cards from the library page', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a'), item('b')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(2)
    const card = wrapper.get('[data-testid="library-card-a"]')
    expect(card.find('.library-chips').text()).toContain('Focus: gap-a')
    expect(card.find('.library-desc').text()).toBe('No activity yet')
  })

  it('shows the empty state when no results', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="empty-stub"]').exists()).toBe(true)
  })

  it('shows an error message when the fetch fails', async () => {
    sessionsApi.getSessionLibrary.mockRejectedValue(new Error('nope'))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-testid="library-error"]').exists()).toBe(true)
  })

  it('the card links to the session route', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const link = wrapper
      .findAllComponents(stubs.RouterLink)
      .find((c) => c.props('to')?.params?.id === 'a')
    expect(link).toBeTruthy()
    expect(link.props('to')).toEqual({ name: 'session', params: { id: 'a' } })
  })

  it('renders each card as a router-link, not a role=button', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const card = wrapper.get('[data-testid="library-card-a"]')
    const link = card.find('.library-card-link')
    expect(link.element.tagName).toBe('A')
    expect(card.attributes('role')).toBeUndefined()
    expect(card.attributes('tabindex')).toBeUndefined()
  })

  it('does not nest the Continue button inside the card link', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('z', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="library-card-z"] .library-card-link button').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-testid="library-continue-z"]').exists()).toBe(true)
  })

  // Guards the cross-model defect: the library is fed SessionListItem (not
  // RecentSessionSummary). This fails unless SessionListItem carries
  // last_session_summary (Task 1 Step 5b) AND it is in the item() factory.
  it('ended card shows the auto-stripped summary, not "Completed"', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([
        item('z', {
          ended_at: '2026-06-02T00:00:00Z',
          last_session_summary: '[auto] Covered the Krebs cycle',
        }),
      ]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const card = wrapper.get('[data-testid="library-card-z"]')
    expect(card.text()).toContain('Covered the Krebs cycle')
    expect(card.text()).not.toContain('Completed')
  })

  it('refetches with status filter when a status toggle is clicked', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    sessionsApi.getSessionLibrary.mockClear()
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('b', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')
    await flushPromises()
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ended', offset: 0 }),
    )
  })

  it('uses a toggle-group (role=group + aria-pressed), not an incomplete tabs contract', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()

    const group = wrapper.get('.library-filter')
    expect(group.attributes('role')).toBe('group')

    // No tabs contract residue.
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
    expect(wrapper.find('[aria-selected]').exists()).toBe(false)

    // 'all' is the default and is pressed; 'ended' is not.
    expect(wrapper.get('[data-testid="library-filter-all"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.get('[data-testid="library-filter-ended"]').attributes('aria-pressed')).toBe(
      'false',
    )

    await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="library-filter-ended"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.get('[data-testid="library-filter-all"]').attributes('aria-pressed')).toBe(
      'false',
    )
  })

  it('refetches with sort when sort changes', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    sessionsApi.getSessionLibrary.mockClear()
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    await wrapper.get('[data-testid="library-sort"]').setValue('topic')
    await flushPromises()
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'topic' }),
    )
  })

  it('searching resets offset to 0 and passes q', async () => {
    vi.useFakeTimers()
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')], { total: 50 }))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    sessionsApi.getSessionLibrary.mockClear()
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    await wrapper.get('[data-testid="library-search"]').setValue('gly')
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'gly', offset: 0 }),
    )
    vi.useRealTimers()
  })

  it('covers the Untitled topic fallback', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('a', { topic: '' })], { total: 1, limit: 20, offset: 0 }),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-testid="library-card-a"]').text()).toContain('Untitled')
  })

  it('falls back to a generic message on a non-Error rejection', async () => {
    sessionsApi.getSessionLibrary.mockRejectedValue('weird')
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-testid="library-error"]').text()).toBe('Failed to load sessions')
  })

  it('shows a back-to-home link', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const back = wrapper.get('[data-testid="library-back"]')
    expect(back.attributes('to') || back.attributes('href')).toBe('/')
  })

  it('renders a folio eyebrow above the display title', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const folio = wrapper.get('.library-folio')
    expect(folio.text()).toBe('library')
    expect(wrapper.get('.library-title').text()).toBe('All sessions')
  })

  it('ended card shows Continue button; active card does not', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('active1'), item('ended1', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="library-continue-ended1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="library-continue-active1"]').exists()).toBe(false)
  })

  it('clicking Continue topic calls store.continueTopic and navigates without double-firing card navigation', async () => {
    const { useSessionStore } = await import('@/stores/session.js')
    const store = useSessionStore()
    const continueTopicSpy = vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'z' })
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('z', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="library-continue-z"]').trigger('click')
    await flushPromises()
    expect(continueTopicSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'z' }))
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'z' } })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('Continue topic on an ended card creates a resume session and routes to it', async () => {
    const { useSessionStore } = await import('@/stores/session.js')
    const store = useSessionStore()
    const continueTopicSpy = vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'new-9' })
    const endedSession = item('ended1', { ended_at: '2026-06-02T00:00:00Z' })
    sessionsApi.getSessionLibrary.mockResolvedValue(page([endedSession]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    await wrapper.get(`[data-testid="library-continue-${endedSession.id}"]`).trigger('click')
    await flushPromises()
    expect(continueTopicSpy).toHaveBeenCalledWith(expect.objectContaining({ id: endedSession.id }))
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-9' } })
  })

  // F-06: same bug class as F-45 in HomeView -- no busy guard meant a
  // double-click issued two resume-creates, and the store's rethrow escaped
  // as an unhandled rejection.
  it('double-clicking Continue topic creates only one resume session (F-06)', async () => {
    const { useSessionStore } = await import('@/stores/session.js')
    const store = useSessionStore()
    let resolve
    const continueTopicSpy = vi.spyOn(store, 'continueTopic').mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('z', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const btn = wrapper.get('[data-testid="library-continue-z"]')
    await btn.trigger('click')
    await btn.trigger('click')
    resolve({ id: 'new-1' })
    await flushPromises()
    expect(continueTopicSpy).toHaveBeenCalledTimes(1)
  })

  it('a failed Continue topic does not escape as an unhandled rejection (F-06)', async () => {
    const { useSessionStore } = await import('@/stores/session.js')
    const store = useSessionStore()
    vi.spyOn(store, 'continueTopic').mockRejectedValue(new Error('backend down'))
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('z', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const rejections = []
    const onUnhandled = (e) => {
      rejections.push(e)
      e.preventDefault()
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    try {
      await wrapper.get('[data-testid="library-continue-z"]').trigger('click')
      await flushPromises()
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
    expect(rejections).toHaveLength(0)
    expect(push).not.toHaveBeenCalled()
    // The button is usable again for a retry.
    expect(wrapper.get('[data-testid="library-continue-z"]').element.disabled).toBe(false)
  })

  // F-15: two rapid filter clicks issue two fetchLibrary calls; if the first
  // (slow) one settles after the second (fast) one, its stale page must not
  // clobber the fast page's already-rendered results.
  it('drops a stale response that settles after a newer one (F-15)', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()

    let resolveSlow, resolveFast
    sessionsApi.getSessionLibrary
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveSlow = r
        }),
      )
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveFast = r
        }),
      )

    await wrapper.get('[data-testid="library-filter-active"]').trigger('click')
    await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')

    resolveFast(page([item('new')]))
    await flushPromises()
    resolveSlow(page([item('stale')], { total: 9 }))
    await flushPromises()

    expect(wrapper.find('[data-testid="library-card-new"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="library-card-stale"]').exists()).toBe(false)
  })

  it('labels the ended-card action Continue topic', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('z', { ended_at: '2026-06-02T00:00:00Z' })]),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-testid="library-continue-z"]').text()).toBe('Continue topic')
  })

  describe('infinite scroll', () => {
    const lastObserver = () => MockIntersectionObserver.instances.at(-1)

    it('appends the next page when the sentinel intersects', async () => {
      const page1Items = Array.from({ length: 20 }, (_, i) => item(`s${i + 1}`))
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page(page1Items, { total: 45 }))
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()
      expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(20)
      expect(
        lastObserver().observed.has(wrapper.get('[data-testid="library-sentinel"]').element),
      ).toBe(true)

      const page2Items = Array.from({ length: 20 }, (_, i) => item(`s${i + 21}`))
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(
        page(page2Items, { total: 45, offset: 20 }),
      )
      lastObserver().trigger(true)
      await flushPromises()

      expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 20 }),
      )
      expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(40)
      expect(wrapper.find('[data-testid="library-card-s1"]').exists()).toBe(true)
    })

    it('does not fetch once all items are loaded', async () => {
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(
        page([item('a'), item('b')], { total: 2 }),
      )
      mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      sessionsApi.getSessionLibrary.mockClear()
      lastObserver().trigger(true)
      await flushPromises()
      expect(sessionsApi.getSessionLibrary).not.toHaveBeenCalled()
    })

    it('does not double-fetch while a page is in flight', async () => {
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page([item('a')], { total: 45 }))
      mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      sessionsApi.getSessionLibrary.mockClear()
      let resolveAppend
      sessionsApi.getSessionLibrary.mockReturnValueOnce(
        new Promise((r) => {
          resolveAppend = r
        }),
      )
      lastObserver().trigger(true)
      lastObserver().trigger(true)
      await flushPromises()
      expect(sessionsApi.getSessionLibrary).toHaveBeenCalledTimes(1)

      resolveAppend(page([item('b')], { total: 45, offset: 1 }))
      await flushPromises()
    })

    it('filter change clears the list and refetches from offset 0', async () => {
      const page1Items = Array.from({ length: 20 }, (_, i) => item(`s${i + 1}`))
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page(page1Items, { total: 45 }))
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      const page2Items = Array.from({ length: 20 }, (_, i) => item(`s${i + 21}`))
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(
        page(page2Items, { total: 45, offset: 20 }),
      )
      lastObserver().trigger(true)
      await flushPromises()
      expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(40)

      sessionsApi.getSessionLibrary.mockClear()
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(
        page([item('e1', { ended_at: '2026-06-02T00:00:00Z' })], { total: 1 }),
      )
      await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')
      await flushPromises()

      expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ended', offset: 0 }),
      )
      expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(1)
      expect(wrapper.find('[data-testid="library-card-s1"]').exists()).toBe(false)
    })

    it('append error shows retry and pauses; retry resumes', async () => {
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page([item('a')], { total: 45 }))
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      sessionsApi.getSessionLibrary.mockRejectedValueOnce(new Error('append failed'))
      lastObserver().trigger(true)
      await flushPromises()
      expect(wrapper.find('[data-testid="library-retry"]').exists()).toBe(true)

      sessionsApi.getSessionLibrary.mockClear()
      lastObserver().trigger(true)
      await flushPromises()
      expect(sessionsApi.getSessionLibrary).not.toHaveBeenCalled()

      sessionsApi.getSessionLibrary.mockResolvedValueOnce(
        page([item('b')], { total: 45, offset: 1 }),
      )
      await wrapper.get('[data-testid="library-retry"]').trigger('click')
      await flushPromises()
      expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 1 }),
      )
      expect(wrapper.find('[data-testid="library-retry"]').exists()).toBe(false)
    })

    it('stale response is dropped (race guard)', async () => {
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page([item('a')], { total: 45 }))
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      let resolveAppend
      sessionsApi.getSessionLibrary.mockReturnValueOnce(
        new Promise((r) => {
          resolveAppend = r
        }),
      )
      lastObserver().trigger(true) // starts an append at offset 1

      let resolveFilter
      sessionsApi.getSessionLibrary.mockReturnValueOnce(
        new Promise((r) => {
          resolveFilter = r
        }),
      )
      await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')

      resolveFilter(page([item('e1', { ended_at: '2026-06-02T00:00:00Z' })], { total: 1 }))
      await flushPromises()
      resolveAppend(page([item('stale')], { total: 45, offset: 1 }))
      await flushPromises()

      expect(wrapper.find('[data-testid="library-card-e1"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="library-card-stale"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="library-card-a"]').exists()).toBe(false)
    })

    it('pager is gone', async () => {
      sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()
      expect(wrapper.find('[data-testid="library-prev"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="library-next"]').exists()).toBe(false)
    })

    it('unobserves the sentinel when it unmounts (filter change to an empty result set)', async () => {
      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page([item('a')], { total: 1 }))
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()
      const sentinel = wrapper.get('[data-testid="library-sentinel"]').element
      expect(lastObserver().observed.has(sentinel)).toBe(true)

      sessionsApi.getSessionLibrary.mockResolvedValueOnce(page([], { total: 0 }))
      await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="library-sentinel"]').exists()).toBe(false)
      expect(lastObserver().observed.has(sentinel)).toBe(false)
      expect(lastObserver().observed.size).toBe(0)
    })
  })

  describe('route query init', () => {
    it('seeds status and q from the route query on mount', async () => {
      mockRouteQuery = { status: 'ended', q: 'gly' }
      sessionsApi.getSessionLibrary.mockResolvedValue(
        page([item('a', { ended_at: '2026-06-02T00:00:00Z' })]),
      )
      const wrapper = mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ended', q: 'gly', offset: 0 }),
      )
      expect(wrapper.get('[data-testid="library-filter-ended"]').attributes('aria-pressed')).toBe(
        'true',
      )
      expect(wrapper.get('[data-testid="library-search"]').element.value).toBe('gly')
    })

    it('ignores an invalid status query value', async () => {
      mockRouteQuery = { status: 'garbage' }
      sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
      mount(SessionsLibraryView, { global: { stubs } })
      await flushPromises()

      expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'all' }),
      )
    })
  })
})

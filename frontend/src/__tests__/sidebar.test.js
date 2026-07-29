import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const routerPush = vi.fn()
const routeRef = { params: {}, fullPath: '/' }
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  useRouter: () => ({ push: routerPush }),
  useRoute: () => routeRef,
}))
const showSuccess = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError: vi.fn(), showWarn: vi.fn(), showSuccess }),
}))
const apiReviewQueue = vi.fn()
vi.mock('@/services/reviewApi.js', () => ({
  getReviewQueue: (...args) => apiReviewQueue(...args),
}))
const apiGetSessionLibrary = vi.fn()
vi.mock('@/services/sessionsApi.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getSessionLibrary: (...args) => apiGetSessionLibrary(...args),
  }
})

import Sidebar from '@/components/sidebar/Sidebar.vue'
import { useSessionStore } from '@/stores/session.js'
import { useAuthStore } from '@/stores/auth.js'
import { useSidebar, __test__ as sidebarTest } from '@/composables/useSidebar.js'
import { RouterLink as MockRouterLink } from 'vue-router'

function setViewport(w) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
  sidebarTest._setViewport(w)
}

// File-wide default so every describe block that mounts Sidebar while
// authenticated (triggering the review-queue fetch in onMounted) gets a
// resolved promise instead of an unmocked vi.fn() undefined return.
// Individual review-entry tests override this per case.
beforeEach(() => {
  apiReviewQueue.mockReset()
  apiReviewQueue.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 })
  apiGetSessionLibrary.mockReset()
  apiGetSessionLibrary.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
})

describe('Sidebar.vue — session list rendering', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400) // desktop expanded
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
  })
  afterEach(() => wrapper?.unmount())

  it('shows skeleton while loading and no sessions yet', async () => {
    const store = useSessionStore()
    store.loading = true
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-skel-list').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-empty-hint"]').exists()).toBe(false)
  })

  it('shows empty hint when not loading and zero sessions', async () => {
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-empty-hint"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No sessions yet')
  })

  it('renders Active section with rows; no Ended section when empty', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
      { id: 'a2', topic: 'Trees', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-active"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-section-ended"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a2"]').exists()).toBe(true)
  })

  it('shows an Ended tab with a count when ended sessions exist', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
      {
        id: 'e1',
        topic: 'Recursion',
        created_at: '2026-05-15T10:00:00Z',
        ended_at: '2026-05-18T10:00:00Z',
      },
    ]
    // Badge reads the store's server-side total, not the loaded row count.
    store.endedTotal = 1
    wrapper = mount(Sidebar)
    await flushPromises()
    // Default view is Active: the ended row is behind the Ended tab, not visible yet.
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(false)
    const endedTab = wrapper.find('[data-testid="sidebar-status-ended"]')
    expect(endedTab.exists()).toBe(true)
    expect(endedTab.text()).toContain('1')
  })

  it('Active/Ended toggle switches which sessions are shown', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Active one', created_at: '2026-05-20T10:00:00Z', ended_at: null },
      {
        id: 'e1',
        topic: 'Ended one',
        created_at: '2026-05-15T10:00:00Z',
        ended_at: '2026-05-18T10:00:00Z',
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Active view by default.
    expect(wrapper.find('[data-testid="sidebar-status-active"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(false)
    // Switch to Ended.
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-status-ended"]').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(false)
  })

  it('keeps the pinned mini-group under the Active view only', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'p1',
        topic: 'Pinned',
        created_at: '2026-05-20T10:00:00Z',
        ended_at: null,
        pinned: true,
      },
      {
        id: 'e1',
        topic: 'Ended',
        created_at: '2026-05-15T10:00:00Z',
        ended_at: '2026-05-18T10:00:00Z',
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(true)
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(false)
  })

  it('marks current session row with aria-current=page', async () => {
    routeRef.params = { id: 'a1' }
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const btn = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-open"]')
    expect(btn.attributes('aria-current')).toBe('page')
  })

  it('collapsed tooltip is the plain session topic', async () => {
    sidebarTest._setExpanded(false)
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Glycolysis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const btn = wrapper.get('[data-testid="sidebar-row-a1"] [data-testid="sidebar-row-open"]')
    expect(btn.attributes('title')).toBe('Glycolysis')
  })

  it('highlights the current session row', async () => {
    routeRef.params = { id: 'a1' }
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Glycolysis', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Closes clause (b) of the spec's first WS2 test bullet (current session highlighted)
    // with an automated check rather than deferring entirely to live smoke.
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').classes()).toContain('sb-row--current')
  })

  it('filters sessions via the search input and shows a match count', async () => {
    vi.useFakeTimers()
    try {
      const store = useSessionStore()
      store.sessions = [
        {
          id: 'a1',
          topic: 'Photosynthesis',
          created_at: new Date().toISOString(),
          ended_at: null,
        },
        { id: 'a2', topic: 'Big-O notation', created_at: new Date().toISOString(), ended_at: null },
      ]
      apiGetSessionLibrary.mockResolvedValue({
        items: [{ id: 'a1', topic: 'Photosynthesis', ended_at: null }],
        total: 1,
      })
      wrapper = mount(Sidebar)
      await flushPromises()
      await wrapper.find('[data-testid="sidebar-search"]').setValue('photo')
      await vi.advanceTimersByTimeAsync(250)
      await flushPromises()
      expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="sidebar-row-a2"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="sidebar-search-count"]').text()).toContain('1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a no-match hint when search matches nothing', async () => {
    vi.useFakeTimers()
    try {
      const store = useSessionStore()
      store.sessions = [
        { id: 'a1', topic: 'Photosynthesis', created_at: new Date().toISOString(), ended_at: null },
      ]
      apiGetSessionLibrary.mockResolvedValue({ items: [], total: 0 })
      wrapper = mount(Sidebar)
      await flushPromises()
      await wrapper.find('[data-testid="sidebar-search"]').setValue('zzz')
      await vi.advanceTimersByTimeAsync(250)
      await flushPromises()
      expect(wrapper.find('[data-testid="sidebar-search-empty"]').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders active sessions as one flat list without date group labels', async () => {
    const store = useSessionStore()
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 3 * 86400000)
    const older = new Date(now.getTime() - 20 * 86400000)
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: now.toISOString(), ended_at: null },
      { id: 'a2', topic: 'Trees', created_at: weekAgo.toISOString(), ended_at: null },
      { id: 'a3', topic: 'Graphs', created_at: older.toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid^="sidebar-group-"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('This week')
    expect(wrapper.text()).not.toContain('Older')
    // all rows still present
    expect(wrapper.findAll('[data-testid="sidebar-row-open"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a3"]').exists()).toBe(true)
  })

  it('renders the pinned mini-group when a session is pinned', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'p1',
        topic: 'Pinned',
        created_at: new Date().toISOString(),
        ended_at: null,
        pinned: true,
      },
      { id: 'a1', topic: 'Normal', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(true)
    expect(
      wrapper
        .find('[data-testid="sidebar-section-pinned"] [data-testid="sidebar-row-p1"]')
        .exists(),
    ).toBe(true)
  })

  it('clears the search query when the sidebar collapses so the rail is not blank', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Photosynthesis', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('photo')
    await flushPromises()
    // collapse the sidebar
    await wrapper.find('[data-testid="sidebar-collapse-toggle"]').trigger('click')
    await flushPromises()
    // search input is gone (v-if on isExpanded)
    expect(wrapper.find('[data-testid="sidebar-search"]').exists()).toBe(false)
    // collapsed rail must show the session row — fails before Fix 1 because searching stays true
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
  })
})

describe('sidebar server-side search', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400) // desktop expanded
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
    vi.useFakeTimers()
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it('debounces 250ms then queries the library endpoint scoped to the current tab', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('gly')
    await vi.advanceTimersByTimeAsync(249)
    expect(apiGetSessionLibrary).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(apiGetSessionLibrary).toHaveBeenCalledWith(
      { status: 'active', q: 'gly', sort: 'last_activity', limit: 20, offset: 0 },
      { silent: true },
    )
  })

  it('renders server results and total; store sessions array untouched', async () => {
    const store = useSessionStore()
    const seeded = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    store.sessions = seeded
    apiGetSessionLibrary.mockResolvedValue({
      items: [
        { id: 'r1', topic: 'Glycolysis', ended_at: null },
        { id: 'r2', topic: 'Glycogen', ended_at: null },
      ],
      total: 12,
    })
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('gly')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-row-r1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-r2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-search-count"]').text()).toContain('12')
    // Content (not identity, since Vue wraps assigned arrays in a reactive
    // proxy) must still equal the original seeded value -- search must never
    // write the store's `sessions` array.
    expect(store.sessions).toEqual(seeded)
  })

  it('shows View all with the query when total exceeds results', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    apiGetSessionLibrary.mockResolvedValue({
      items: [
        { id: 'r1', topic: 'Glycolysis', ended_at: null },
        { id: 'r2', topic: 'Glycogen', ended_at: null },
      ],
      total: 12,
    })
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('gly')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    const viewAll = wrapper.find('[data-testid="sidebar-view-all-search"]')
    expect(viewAll.exists()).toBe(true)
    const viewAllComponent = wrapper
      .findAllComponents(MockRouterLink)
      .find((c) => c.attributes('data-testid') === 'sidebar-view-all-search')
    expect(viewAllComponent.props('to')).toEqual({
      name: 'sessions-library',
      query: { status: 'active', q: 'gly' },
    })
  })

  it('drops stale responses (later query wins)', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    let resolveAa
    let resolveBb
    apiGetSessionLibrary.mockImplementation((params) => {
      if (params.q === 'aa') return new Promise((resolve) => (resolveAa = resolve))
      if (params.q === 'bb') return new Promise((resolve) => (resolveBb = resolve))
      return Promise.resolve({ items: [], total: 0 })
    })
    wrapper = mount(Sidebar)
    await flushPromises()
    // Type 'aa' and advance a full debounce cycle so its request genuinely
    // fires and is in flight BEFORE 'bb' is typed. If both were typed
    // back-to-back, the watch's own clearTimeout on every keystroke would
    // mean 'aa' is never issued at all -- this test would then pass with the
    // _searchSeq guards deleted, proving nothing about the guard.
    await wrapper.find('[data-testid="sidebar-search"]').setValue('aa')
    await vi.advanceTimersByTimeAsync(250)
    await wrapper.find('[data-testid="sidebar-search"]').setValue('bb')
    await vi.advanceTimersByTimeAsync(250)
    expect(apiGetSessionLibrary).toHaveBeenCalledTimes(2)

    // Resolve 'aa' (the stale request) AFTER 'bb' (the current request).
    resolveBb({ items: [{ id: 'bb1', topic: 'bb result', ended_at: null }], total: 1 })
    await flushPromises()
    resolveAa({ items: [{ id: 'aa1', topic: 'aa result', ended_at: null }], total: 1 })
    await flushPromises()

    expect(wrapper.find('[data-testid="sidebar-row-bb1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-aa1"]').exists()).toBe(false)
  })

  it('clearing the query restores the tab view without a fetch', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('gly')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    apiGetSessionLibrary.mockClear()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('')
    await flushPromises()
    expect(apiGetSessionLibrary).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="sidebar-section-active"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
  })

  it('renders zero matches silently (no toast) when the library fetch errors', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    apiGetSessionLibrary.mockRejectedValue(new Error('boom'))
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('gly')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-search-empty"]').exists()).toBe(true)
    expect(showSuccess).not.toHaveBeenCalled()
  })

  it('does not throw when unmounted mid-debounce', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('gly')
    wrapper.unmount()
    wrapper = null
    // The pending debounce timer must be cleared on unmount; advancing past
    // it must not call the (now-orphaned) endpoint or throw.
    await vi.advanceTimersByTimeAsync(250)
    expect(apiGetSessionLibrary).not.toHaveBeenCalled()
  })
})

describe('Sidebar.vue — row interactions', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    showSuccess.mockClear()
    localStorage.clear()
    setViewport(1400)
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
    routeRef.name = undefined
  })
  afterEach(() => wrapper?.unmount())

  it('clicking a row navigates to its session', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-open"]').trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'session', params: { id: 'a1' } })
  })

  it('row menu opens then closes on action', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-row-menu-popover"]').exists()).toBe(false)
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-popover"]').exists()).toBe(true)
  })

  it('popover uses honest group semantics, not role=menu', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    const pop = wrapper.get('[data-testid="sidebar-row-menu-popover"]')
    expect(pop.attributes('role')).toBe('group')
    expect(pop.attributes('aria-label')).toBeTruthy()
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(0)
    expect(
      wrapper
        .get('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
        .attributes('aria-haspopup'),
    ).toBeUndefined()
  })

  it('End session menu item calls store.endSession with row id', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    const endSpy = vi.spyOn(store, 'endSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    expect(endSpy).toHaveBeenCalledWith('a1')
  })

  it("End session toasts the pending summary when ending from off that session's view (F-44)", async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    vi.spyOn(store, 'endSession').mockImplementation(async (id) => {
      store.pendingSummary = { sessionId: id, kind: 'summary', text: 'Great progress on Big-O.' }
      return {}
    })
    // Not on that session's own view — SessionView isn't mounted to consume it.
    routeRef.name = 'home'
    routeRef.params = {}
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    await flushPromises()
    expect(showSuccess).toHaveBeenCalledWith('Great progress on Big-O.')
    expect(store.pendingSummary).toBe(null)
  })

  it("End session does not toast when this session's own view is active", async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    vi.spyOn(store, 'endSession').mockImplementation(async (id) => {
      store.pendingSummary = { sessionId: id, kind: 'summary', text: 'Great progress on Big-O.' }
      return {}
    })
    routeRef.name = 'session'
    routeRef.params = { id: 'a1' }
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(store.pendingSummary).not.toBe(null)
  })

  it('Resume menu item calls store.reopenSession and navigates', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' }]
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper
      .find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-resume"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('e1')
    expect(routerPush).toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
  })

  it('ended row menu offers Continue topic which calls store.continueTopic and routes', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' }]
    const continueTopicSpy = vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'new-1' })
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper
      .find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-continue-topic"]').trigger('click')
    await flushPromises()
    expect(continueTopicSpy).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-1' } })
  })

  it('Ended row still offers Resume alongside Continue topic', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' }]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper
      .find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-resume"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-menu-continue-topic"]').exists()).toBe(true)
  })

  it('Ended row does not offer End menu item', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' }]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper
      .find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-end"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-row-menu-resume"]').exists()).toBe(true)
  })

  it('active row menu offers Rename and Pin', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-rename"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-menu-pin"]').exists()).toBe(true)
  })

  it('Pin menu item calls store.setPinned(true)', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const pinSpy = vi.spyOn(store, 'setPinned').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-pin"]').trigger('click')
    expect(pinSpy).toHaveBeenCalledWith('a1', true)
  })

  it('Pin keeps focus on the row trigger after the row moves to the pinned section', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
      { id: 'a2', topic: 'Y', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    // spy flips real store state so the row relocates across sections
    vi.spyOn(store, 'setPinned').mockImplementation(async (id, pinned) => {
      const s = store.sessions.find((x) => x.id === id)
      if (s) s.pinned = pinned
      return {}
    })
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-pin"]').trigger('click')
    await flushPromises()
    const active = document.activeElement
    const a1Trigger = wrapper.find(
      '[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]',
    ).element
    expect(active).toBe(a1Trigger)
  })

  it('Rename enters inline edit and commits on Enter via store.renameSession', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    expect(input.exists()).toBe(true)
    await input.setValue('New name')
    await input.trigger('keydown.enter')
    expect(renameSpy).toHaveBeenCalledWith('a1', 'New name')
  })

  it('Rename cancels on Escape without calling the store', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('Discard me')
    await input.trigger('keydown.esc')
    expect(renameSpy).not.toHaveBeenCalled()
    expect(
      wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]').exists(),
    ).toBe(false)
  })

  it('Rename Enter with unchanged topic does not call the store', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Same',
        created_at: '2026-05-20T10:00:00Z',
        ended_at: null,
        pinned: false,
      },
    ]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('Same')
    await input.trigger('keydown.enter')
    expect(renameSpy).not.toHaveBeenCalled()
  })

  it('Rename Enter with empty topic does not call the store', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('   ')
    await input.trigger('keydown.enter')
    expect(renameSpy).not.toHaveBeenCalled()
  })

  it('does not show the pin glyph on an ended (but pinned) session', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'e1',
        topic: 'EndedPinned',
        created_at: '2026-05-20T10:00:00Z',
        ended_at: '2026-05-21T10:00:00Z',
        pinned: true,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Ended view is v-if-gated behind the Ended tab; switch to it first.
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.find('[data-session-id="e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-session-id="e1"] .sb-row-pin').exists()).toBe(false)
  })

  it('shows the pin glyph on an active pinned session', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'ActivePinned',
        created_at: '2026-05-20T10:00:00Z',
        ended_at: null,
        pinned: true,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-session-id="a1"] .sb-row-pin').exists()).toBe(true)
  })

  it('Rename commits exactly once on Enter even though blur also fires', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('New')
    await input.trigger('keydown.enter')
    try {
      await input.trigger('blur')
    } catch {
      /* input may be detached after rename exits */
    }
    await flushPromises()
    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(renameSpy).toHaveBeenCalledWith('a1', 'New')
  })
})

describe('Sidebar.vue — footer rail labels', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
  })
  afterEach(() => wrapper?.unmount())

  it('footer shows text labels when expanded', async () => {
    wrapper = mount(Sidebar)
    await flushPromises()
    const footer = wrapper.find('[data-testid="sidebar-profile"]')
    expect(footer.exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-profile"]').text()).toContain('Profile')
  })

  it('footer hides text labels when collapsed', async () => {
    sidebarTest._setExpanded(false)
    wrapper = mount(Sidebar)
    await flushPromises()
    // collapsed: footer carries sb-rail--column class
    expect(wrapper.find('footer.sb-rail').classes()).toContain('sb-rail--column')
    // no label text visible
    expect(wrapper.find('[data-testid="sidebar-profile"]').text()).not.toContain('Profile')
  })

  it('footer rail no longer renders theme or sign-out controls', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-theme-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-sign-out"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-profile"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-settings"]').exists()).toBe(true)
  })
})

describe('Sidebar.vue — mount fetch', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
    sidebarTest._setExpanded(true)
    routeRef.params = {}
  })
  afterEach(() => wrapper?.unmount())

  it('calls store.listSessions on mount when authenticated and empty', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const store = useSessionStore()
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(listSpy).toHaveBeenCalled()
  })

  it('skips list fetch when sessions already populated', async () => {
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null }]
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('skips list fetch when unauthenticated', async () => {
    const store = useSessionStore()
    const listSpy = vi.spyOn(store, 'listSessions').mockResolvedValue([])
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(listSpy).not.toHaveBeenCalled()
  })
})

describe('Sidebar.vue — review entry', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
    // Review-queue badge fetch is gated on isAuthenticated, same signal the
    // sessions fetch already uses (see "mount fetch" describe above).
    const auth = useAuthStore()
    auth.session = { user: { id: 'u-1' }, access_token: 't' }
    // Sessions fetch runs before the review-queue fetch in onMounted; stub it
    // so the unrelated real network call doesn't delay/interfere with the
    // review assertions (mirrors the "mount fetch" describe's pattern).
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
  })
  afterEach(() => wrapper?.unmount())

  it('shows the review entry with a count when concepts are due', async () => {
    apiReviewQueue.mockResolvedValue({ items: [], total: 13, limit: 1, offset: 0 })
    wrapper = mount(Sidebar)
    await flushPromises()
    const entry = wrapper.get('[data-testid="sidebar-review"]')
    expect(entry.text()).toContain('Review')
    expect(entry.text()).toContain('13')
    expect(apiReviewQueue).toHaveBeenCalledWith({ limit: 1, offset: 0 }, { silent: true })
  })

  it('hides the review entry when nothing is due', async () => {
    apiReviewQueue.mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 })
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-review"]').exists()).toBe(false)
  })

  it('hides the review entry when the fetch fails', async () => {
    apiReviewQueue.mockRejectedValue(new Error('boom'))
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-review"]').exists()).toBe(false)
  })

  it('hides the review entry in icon-rail (collapsed) mode even with a count due', async () => {
    sidebarTest._setExpanded(false)
    apiReviewQueue.mockResolvedValue({ items: [], total: 13, limit: 1, offset: 0 })
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-review"]').exists()).toBe(false)
  })
})

describe('session store — rename + pin actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renameSession optimistically updates the row and calls the API', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const api = await import('@/services/sessionsApi.js')
    vi.spyOn(api, 'renameSession').mockResolvedValue({ id: 'a1', topic: 'new', pinned: false })
    await store.renameSession('a1', 'new')
    expect(store.sessions[0].topic).toBe('new')
    expect(api.renameSession).toHaveBeenCalledWith('a1', 'new')
  })

  it('setPinned applies optimistic update then rolls back on API error', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'x', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const api = await import('@/services/sessionsApi.js')
    let reject
    vi.spyOn(api, 'setPinned').mockReturnValue(
      new Promise((_, r) => {
        reject = r
      }),
    )
    const p = store.setPinned('a1', true).catch(() => {})
    expect(store.sessions[0].pinned).toBe(true) // optimistic applied
    reject(new Error('boom'))
    await p
    expect(store.sessions[0].pinned).toBe(false) // rolled back
  })

  it('setPinned syncs currentSession.pinned and rolls it back on error', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    store.currentSession = { id: 'a1', topic: 'X', ended_at: null, pinned: false }
    const api = await import('@/services/sessionsApi.js')
    let reject
    vi.spyOn(api, 'setPinned').mockReturnValue(
      new Promise((_, r) => {
        reject = r
      }),
    )
    const p = store.setPinned('a1', true).catch(() => {})
    expect(store.currentSession.pinned).toBe(true)
    reject(new Error('boom'))
    await p
    expect(store.currentSession.pinned).toBe(false)
  })

  it('renameSession rolls back topic on API error', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false },
    ]
    const api = await import('@/services/sessionsApi.js')
    let reject
    vi.spyOn(api, 'renameSession').mockReturnValue(
      new Promise((_, r) => {
        reject = r
      }),
    )
    const p = store.renameSession('a1', 'new').catch(() => {})
    expect(store.sessions[0].topic).toBe('new') // optimistic applied
    reject(new Error('boom'))
    await p
    expect(store.sessions[0].topic).toBe('old') // rolled back
  })
})

describe('Sidebar.vue — header states', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
  })
  afterEach(() => {
    wrapper?.unmount()
    useSidebar().closeDrawer()
  })

  it('expanded desktop header shows the logo and a collapse toggle', async () => {
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-brand').exists()).toBe(true)
    const toggle = wrapper.find('[data-testid="sidebar-collapse-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('Collapse sidebar')
  })

  it('collapsed desktop header shows only the expand toggle, no logo', async () => {
    sidebarTest._setExpanded(false)
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-brand').exists()).toBe(false)
    const toggle = wrapper.find('[data-testid="sidebar-collapse-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('Expand sidebar')
  })

  it('mobile drawer header shows the logo and a right-aligned close button', async () => {
    setViewport(600)
    const { openDrawer } = useSidebar()
    openDrawer()
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('.sb-brand').exists()).toBe(true)
    const close = wrapper.find('[data-testid="sidebar-drawer-close"]')
    expect(close.exists()).toBe(true)
    expect(close.classes()).toContain('sb-toggle--end')
  })
})

// Builds N active sessions with descending activity so ordering is deterministic
// (most-recent first) when the component slices down to the cap.
function makeActiveSessions(count, { pinned = false, prefix = 'u' } = {}) {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    topic: `${prefix}${i}`,
    created_at: new Date(now - i * 1000).toISOString(),
    last_activity_at: new Date(now - i * 1000).toISOString(),
    ended_at: null,
    pinned,
  }))
}

function makeEndedSessions(count) {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    topic: `e${i}`,
    created_at: new Date(now - i * 1000).toISOString(),
    last_activity_at: new Date(now - i * 1000).toISOString(),
    ended_at: new Date(now - i * 1000).toISOString(),
  }))
}

describe('sidebar 20-row cap and View all links', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400) // desktop expanded
    sidebarTest._setExpanded(true)
    routeRef.params = {}
    routeRef.fullPath = '/'
  })
  afterEach(() => wrapper?.unmount())

  it('renders at most 20 active rows (pinned count toward the cap)', async () => {
    const store = useSessionStore()
    const pinnedRows = makeActiveSessions(3, { pinned: true, prefix: 'p' })
    const unpinnedRows = makeActiveSessions(25, { pinned: false, prefix: 'u' })
    store.sessions = [...pinnedRows, ...unpinnedRows]
    store.activeTotal = 28
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(
      wrapper.findAll('[data-testid="sidebar-section-pinned"] [data-session-id]'),
    ).toHaveLength(3)
    expect(wrapper.findAll('[data-testid="sidebar-quick-group"] [data-session-id]')).toHaveLength(
      17,
    )
    const viewAll = wrapper.find('[data-testid="sidebar-view-all-active"]')
    expect(viewAll.exists()).toBe(true)
    expect(viewAll.text()).toContain('View all 28 sessions')
    const viewAllComponent = wrapper
      .findAllComponents(MockRouterLink)
      .find((c) => c.attributes('data-testid') === 'sidebar-view-all-active')
    expect(viewAllComponent.props('to')).toEqual({
      name: 'sessions-library',
      query: { status: 'active' },
    })
  })

  it('caps pinned rows themselves at 20, leaving no room for unpinned rows', async () => {
    const store = useSessionStore()
    const pinnedRows = makeActiveSessions(25, { pinned: true, prefix: 'p' })
    const unpinnedRows = makeActiveSessions(5, { pinned: false, prefix: 'u' })
    store.sessions = [...pinnedRows, ...unpinnedRows]
    store.activeTotal = 30
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(
      wrapper.findAll('[data-testid="sidebar-section-pinned"] [data-session-id]'),
    ).toHaveLength(20)
    expect(wrapper.findAll('[data-testid="sidebar-quick-group"] [data-session-id]')).toHaveLength(0)
  })

  it('caps the collapsed icon rail at 20 pinned rows too', async () => {
    sidebarTest._setExpanded(false)
    const store = useSessionStore()
    store.sessions = makeActiveSessions(25, { pinned: true, prefix: 'p' })
    store.activeTotal = 25
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.findAll('.sb-session-list--collapsed [data-session-id]')).toHaveLength(20)
  })

  it('caps the ended tab at 20 and links with status=ended', async () => {
    const store = useSessionStore()
    store.sessions = makeEndedSessions(22)
    store.endedTotal = 40
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.findAll('[data-testid="sidebar-section-ended"] [data-session-id]')).toHaveLength(
      20,
    )
    const viewAll = wrapper.find('[data-testid="sidebar-view-all-ended"]')
    expect(viewAll.exists()).toBe(true)
    expect(viewAll.text()).toContain('40')
    const viewAllComponent = wrapper
      .findAllComponents(MockRouterLink)
      .find((c) => c.attributes('data-testid') === 'sidebar-view-all-ended')
    expect(viewAllComponent.props('to')).toEqual({
      name: 'sessions-library',
      query: { status: 'ended' },
    })
  })

  it('hides View all when the tab total fits the rendered rows', async () => {
    const store = useSessionStore()
    store.sessions = makeActiveSessions(5)
    store.activeTotal = 5
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-view-all-active"]').exists()).toBe(false)
  })

  it('ended tab badge shows the server total, not the loaded count', async () => {
    const store = useSessionStore()
    store.sessions = makeEndedSessions(20)
    store.endedTotal = 40
    wrapper = mount(Sidebar)
    await flushPromises()
    const endedTab = wrapper.find('[data-testid="sidebar-status-ended"]')
    expect(endedTab.text()).toContain('(40)')
  })

  it('ending a session from the sidebar updates the Ended badge and View all counts immediately, without a refetch', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Big-O',
        created_at: '2026-05-20T10:00:00Z',
        ended_at: null,
        pinned: false,
      },
    ]
    store.activeTotal = 1
    store.endedTotal = 0
    const api = await import('@/services/sessionsApi.js')
    vi.spyOn(api, 'endSession').mockResolvedValue({
      ended_at: '2026-05-21T10:00:00Z',
      summary: null,
    })
    const listSpy = vi.spyOn(store, 'listSessions')
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]')
      .trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    await flushPromises()
    expect(listSpy).not.toHaveBeenCalled()
    expect(store.activeTotal).toBe(0)
    expect(store.endedTotal).toBe(1)
    const endedTab = wrapper.find('[data-testid="sidebar-status-ended"]')
    expect(endedTab.text()).toContain('(1)')
  })
})

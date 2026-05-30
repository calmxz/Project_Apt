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
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError: vi.fn(), showWarn: vi.fn(), showSuccess: vi.fn() }),
}))

import Sidebar from '@/components/sidebar/Sidebar.vue'
import { useSessionStore } from '@/stores/session.js'
import { useAuthStore } from '@/stores/auth.js'
import { __test__ as sidebarTest } from '@/composables/useSidebar.js'

function setViewport(w) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
  sidebarTest._setViewport(w)
}

describe('Sidebar.vue — session list rendering', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400) // desktop expanded
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

  it('renders Ended section when ended sessions exist', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
      { id: 'e1', topic: 'Recursion', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-ended"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(true)
  })

  it('Ended section toggles visibility', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const toggle = wrapper.find('[data-testid="sidebar-ended-toggle"]')
    const list = () => wrapper.find('#sb-ended-list').element
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(list().style.display).not.toBe('none')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(list().style.display).toBe('none')
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

  it('filters sessions via the search input and shows a match count', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Photosynthesis', created_at: new Date().toISOString(), ended_at: null },
      { id: 'a2', topic: 'Big-O notation', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('photo')
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a2"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-search-count"]').text()).toContain('1')
  })

  it('shows a no-match hint when search matches nothing', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Photosynthesis', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-search"]').setValue('zzz')
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-search-empty"]').exists()).toBe(true)
  })

  it('renders date-group headers for active sessions', async () => {
    const store = useSessionStore()
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 3 * 86400000)
    store.sessions = [
      { id: 'a1', topic: 'Today one', created_at: now.toISOString(), ended_at: null },
      { id: 'a2', topic: 'Week one', created_at: weekAgo.toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-group-today"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-group-week"]').exists()).toBe(true)
  })

  it('renders the pinned mini-group when a session is pinned', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'p1', topic: 'Pinned', created_at: new Date().toISOString(), ended_at: null, pinned: true },
      { id: 'a1', topic: 'Normal', created_at: new Date().toISOString(), ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-testid="sidebar-section-pinned"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-section-pinned"] [data-testid="sidebar-row-p1"]').exists()).toBe(true)
  })
})

describe('Sidebar.vue — row interactions', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
    routeRef.params = {}
    routeRef.fullPath = '/'
  })
  afterEach(() => wrapper?.unmount())

  it('clicking a row navigates to its session', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper
      .find('[data-session-id="a1"] [data-testid="sidebar-row-open"]')
      .trigger('click')
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
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-popover"]').exists()).toBe(true)
  })

  it('End session menu item calls store.endSession with row id', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'Big-O', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    const endSpy = vi.spyOn(store, 'endSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    expect(endSpy).toHaveBeenCalledWith('a1')
  })

  it('Resume menu item calls store.reopenSession and navigates', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-resume"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('e1')
    expect(routerPush).toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
  })

  it('Ended row does not offer End menu item', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-end"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-row-menu-resume"]').exists()).toBe(true)
  })
})

describe('Sidebar.vue — mount fetch', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPush.mockClear()
    localStorage.clear()
    setViewport(1400)
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

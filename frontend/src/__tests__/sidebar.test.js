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

import Sidebar from '@/components/sidebar/Sidebar.vue'
import { useSessionStore } from '@/stores/session.js'
import { useAuthStore } from '@/stores/auth.js'
import { useSidebar, __test__ as sidebarTest } from '@/composables/useSidebar.js'

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
      { id: 'e1', topic: 'Recursion', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
    ]
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
      { id: 'e1', topic: 'Ended one', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    // Active view by default.
    expect(wrapper.find('[data-testid="sidebar-status-active"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(false)
    // Switch to Ended.
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-status-ended"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="sidebar-row-e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-a1"]').exists()).toBe(false)
  })

  it('keeps the pinned mini-group under the Active view only', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'p1', topic: 'Pinned', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: true },
      { id: 'e1', topic: 'Ended', created_at: '2026-05-15T10:00:00Z', ended_at: '2026-05-18T10:00:00Z' },
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

  it('renders chips and a compact meta line in each row', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Glycolysis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
        message_count: 4,
        progress: { focus_target_gap: 'ATP yield', mastered_count: 0 },
        last_message_preview: null,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const row = wrapper.find('[data-testid="sidebar-row-a1"]')
    expect(row.find('.sb-row-chips').text()).toContain('ATP yield')
    expect(row.find('.sb-row-desc').exists()).toBe(false)
    expect(row.find('.sb-row-meta').text()).toBe('4 msgs · now')
  })

  it('signal-poor row renders no chips and never prose', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a9',
        topic: 'Mitosis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
        message_count: 4,
        progress: { focus_target_gap: null, mastered_count: 0 },
        last_message_preview: 'That is correct! You listed all four stages.',
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const row = wrapper.find('[data-testid="sidebar-row-a9"]')
    expect(row.find('.sb-row-chips').exists()).toBe(false)
    expect(row.text()).not.toContain('That is correct!')
  })

  it('ended row follows the same chips rule — summary prose never renders', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'e1',
        topic: 'Krebs',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        message_count: 9,
        progress: { focus_target_gap: null, mastered_count: 2 },
        last_session_summary: '[auto] Covered the Krebs cycle',
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    const row = wrapper.find('[data-testid="sidebar-row-e1"]')
    expect(row.find('.sb-row-chips [data-testid="chip-mastered"]').text()).toContain('2')
    expect(row.text()).not.toContain('Covered the Krebs cycle')
  })

  it('aria-describedby lists chips id then meta id when chips exist, meta only otherwise', async () => {
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Glycolysis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
        message_count: 4,
        progress: { focus_target_gap: 'ATP yield', mastered_count: 0 },
        last_message_preview: null,
      },
      {
        id: 'a9',
        topic: 'Mitosis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
        message_count: 4,
        progress: { focus_target_gap: null, mastered_count: 0 },
        last_message_preview: null,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const richBtn = wrapper.get('[data-testid="sidebar-row-a1"] [data-testid="sidebar-row-open"]')
    expect(richBtn.attributes('aria-describedby')).toBe('sb-row-chips-a1 sb-row-meta-a1')
    const sparseBtn = wrapper.get('[data-testid="sidebar-row-a9"] [data-testid="sidebar-row-open"]')
    expect(sparseBtn.attributes('aria-describedby')).toBe('sb-row-meta-a9')
  })

  it('collapsed tooltip is built from chip labels', async () => {
    sidebarTest._setExpanded(false)
    const store = useSessionStore()
    store.sessions = [
      {
        id: 'a1',
        topic: 'Glycolysis',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ended_at: null,
        message_count: 4,
        progress: { focus_target_gap: 'ATP yield', mastered_count: 2 },
        last_message_preview: null,
      },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    const btn = wrapper.get('[data-testid="sidebar-row-a1"] [data-testid="sidebar-row-open"]')
    expect(btn.attributes('title')).toBe('Glycolysis — Focus: ATP yield, 2 mastered')
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

  it('End session toasts the pending summary when ending from off that session\'s view (F-44)', async () => {
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
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    await flushPromises()
    expect(showSuccess).toHaveBeenCalledWith('Great progress on Big-O.')
    expect(store.pendingSummary).toBe(null)
  })

  it('End session does not toast when this session\'s own view is active', async () => {
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
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-end"]').trigger('click')
    await flushPromises()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(store.pendingSummary).not.toBe(null)
  })

  it('Resume menu item calls store.reopenSession and navigates', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper.find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-resume"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('e1')
    expect(routerPush).toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
  })

  it('ended row menu offers Continue topic which calls store.continueTopic and routes', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    const continueTopicSpy = vi.spyOn(store, 'continueTopic').mockResolvedValue({ id: 'new-1' })
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper.find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-continue-topic"]').trigger('click')
    await flushPromises()
    expect(continueTopicSpy).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-1' } })
  })

  it('Ended row still offers Resume alongside Continue topic', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper.find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-resume"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-menu-continue-topic"]').exists()).toBe(true)
  })

  it('Ended row does not offer End menu item', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'X', ended_at: '2026-05-18T10:00:00Z' },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    // Ended rows now live behind the Ended tab (default view is Active).
    await wrapper.find('[data-testid="sidebar-status-ended"]').trigger('click')
    await wrapper.find('[data-session-id="e1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-end"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-row-menu-resume"]').exists()).toBe(true)
  })

  it('active row menu offers Rename and Pin', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="sidebar-row-menu-rename"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-row-menu-pin"]').exists()).toBe(true)
  })

  it('Pin menu item calls store.setPinned(true)', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const pinSpy = vi.spyOn(store, 'setPinned').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
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
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-pin"]').trigger('click')
    await flushPromises()
    const active = document.activeElement
    const a1Trigger = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').element
    expect(active).toBe(a1Trigger)
  })

  it('Rename enters inline edit and commits on Enter via store.renameSession', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    expect(input.exists()).toBe(true)
    await input.setValue('New name')
    await input.trigger('keydown.enter')
    expect(renameSpy).toHaveBeenCalledWith('a1', 'New name')
  })

  it('Rename cancels on Escape without calling the store', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('Discard me')
    await input.trigger('keydown.esc')
    expect(renameSpy).not.toHaveBeenCalled()
    expect(wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]').exists()).toBe(false)
  })

  it('Rename Enter with unchanged topic does not call the store', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Same', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('Same')
    await input.trigger('keydown.enter')
    expect(renameSpy).not.toHaveBeenCalled()
  })

  it('Rename Enter with empty topic does not call the store', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('   ')
    await input.trigger('keydown.enter')
    expect(renameSpy).not.toHaveBeenCalled()
  })

  it('does not show the pin glyph on an ended (but pinned) session', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'e1', topic: 'EndedPinned', created_at: '2026-05-20T10:00:00Z', ended_at: '2026-05-21T10:00:00Z', pinned: true },
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
      { id: 'a1', topic: 'ActivePinned', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: true },
    ]
    wrapper = mount(Sidebar)
    await flushPromises()
    expect(wrapper.find('[data-session-id="a1"] .sb-row-pin').exists()).toBe(true)
  })

  it('Rename commits exactly once on Enter even though blur also fires', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'Old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const renameSpy = vi.spyOn(store, 'renameSession').mockResolvedValue({})
    wrapper = mount(Sidebar, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-menu-trigger"]').trigger('click')
    await wrapper.find('[data-testid="sidebar-row-menu-rename"]').trigger('click')
    const input = wrapper.find('[data-session-id="a1"] [data-testid="sidebar-row-rename-input"]')
    await input.setValue('New')
    await input.trigger('keydown.enter')
    try { await input.trigger('blur') } catch { /* input may be detached after rename exits */ }
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

describe('session store — rename + pin actions', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('renameSession optimistically updates the row and calls the API', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const api = await import('@/services/sessionsApi.js')
    vi.spyOn(api, 'renameSession').mockResolvedValue({ id: 'a1', topic: 'new', pinned: false })
    await store.renameSession('a1', 'new')
    expect(store.sessions[0].topic).toBe('new')
    expect(api.renameSession).toHaveBeenCalledWith('a1', 'new')
  })

  it('setPinned applies optimistic update then rolls back on API error', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'x', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const api = await import('@/services/sessionsApi.js')
    let reject
    vi.spyOn(api, 'setPinned').mockReturnValue(new Promise((_, r) => { reject = r }))
    const p = store.setPinned('a1', true).catch(() => {})
    expect(store.sessions[0].pinned).toBe(true) // optimistic applied
    reject(new Error('boom'))
    await p
    expect(store.sessions[0].pinned).toBe(false) // rolled back
  })

  it('setPinned syncs currentSession.pinned and rolls it back on error', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    store.currentSession = { id: 'a1', topic: 'X', ended_at: null, pinned: false }
    const api = await import('@/services/sessionsApi.js')
    let reject
    vi.spyOn(api, 'setPinned').mockReturnValue(new Promise((_, r) => { reject = r }))
    const p = store.setPinned('a1', true).catch(() => {})
    expect(store.currentSession.pinned).toBe(true)
    reject(new Error('boom'))
    await p
    expect(store.currentSession.pinned).toBe(false)
  })

  it('renameSession rolls back topic on API error', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 'a1', topic: 'old', created_at: '2026-05-20T10:00:00Z', ended_at: null, pinned: false }]
    const api = await import('@/services/sessionsApi.js')
    let reject
    vi.spyOn(api, 'renameSession').mockReturnValue(new Promise((_, r) => { reject = r }))
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

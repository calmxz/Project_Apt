import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
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
    id, topic: `Topic ${id}`, created_at: '2026-06-01T00:00:00Z', ended_at: null,
    message_count: 2, last_activity_at: '2026-06-01T00:00:00Z',
    last_message_preview: null, last_session_summary: null,
    progress: { focus_target_gap: 'gap-' + id, mastered_count: 0 },
    ...over,
  }
}

describe('SessionsLibraryView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    push.mockClear()
    sessionsApi.getSessionLibrary.mockReset()
  })

  it('renders rich cards from the library page', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a'), item('b')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="library-card-"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="library-card-a"]').text()).toContain('Focus: gap-a')
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

  it('navigates to the session on card click', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    await wrapper.get('[data-testid="library-card-a"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a' } })
  })

  // Guards the cross-model defect: the library is fed SessionListItem (not
  // RecentSessionSummary). This fails unless SessionListItem carries
  // last_session_summary (Task 1 Step 5b) AND it is in the item() factory.
  it('ended card shows the auto-stripped summary, not "Completed"', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([
      item('z', { ended_at: '2026-06-02T00:00:00Z',
                  last_session_summary: '[auto] Covered the Krebs cycle' }),
    ]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    const card = wrapper.get('[data-testid="library-card-z"]')
    expect(card.text()).toContain('Covered the Krebs cycle')
    expect(card.text()).not.toContain('Completed')
  })

  it('refetches with status filter when a tab is clicked', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')]))
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    sessionsApi.getSessionLibrary.mockClear()
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('b', { ended_at: '2026-06-02T00:00:00Z' })]))
    await wrapper.get('[data-testid="library-filter-ended"]').trigger('click')
    await flushPromises()
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ended', offset: 0 }),
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

  it('Next advances offset by limit and refetches; Prev goes back', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('a')], { total: 45, limit: 20, offset: 0 }),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()

    sessionsApi.getSessionLibrary.mockClear()
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('b')], { total: 45, limit: 20, offset: 20 }))
    await wrapper.get('[data-testid="library-next"]').trigger('click')
    await flushPromises()
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }))

    sessionsApi.getSessionLibrary.mockClear()
    sessionsApi.getSessionLibrary.mockResolvedValue(page([item('a')], { total: 45, limit: 20, offset: 0 }))
    await wrapper.get('[data-testid="library-prev"]').trigger('click')
    await flushPromises()
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('disables Next on the last page', async () => {
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('a')], { total: 10, limit: 20, offset: 0 }),
    )
    const wrapper = mount(SessionsLibraryView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-testid="library-next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="library-prev"]').attributes('disabled')).toBeDefined()
  })

  it('covers Untitled topic and the empty 0-of-0 range', async () => {
    // total:0 with one item exercises both `topic || 'Untitled'` and rangeLabel '0 of 0'.
    sessionsApi.getSessionLibrary.mockResolvedValue(
      page([item('a', { topic: '' })], { total: 0, limit: 20, offset: 0 }),
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
})

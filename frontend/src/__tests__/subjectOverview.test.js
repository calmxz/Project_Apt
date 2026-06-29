import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: { id: 's1' } }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ getSubject: vi.fn(), openLesson: vi.fn() }))
vi.mock('@/services/sessionsApi.js', () => ({
  listSessions: vi.fn().mockResolvedValue([]),
  endSession: vi.fn().mockResolvedValue({ ended_at: '2026-06-29T00:00:00Z', summary: null }),
}))

import SubjectOverview from '@/views/SubjectOverview.vue'
import { useSubjectStore } from '@/stores/subject.js'
import { useSessionStore } from '@/stores/session.js'

const overview = {
  id: 's1', title: 'Organic Chemistry', per_session_minutes: 30,
  duration_mode: 'deadline', timeline_days: 14, pace_per_week: 3,
  archived_at: null, progress: { done_count: 2, total_count: 3 },
  lessons: [
    { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
    { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Alkanes', goal: 'g', status: 'done', session_id: 'sess2' },
    { id: 'l3', subject_id: 's1', order_idx: 2, title: 'Reactions', goal: 'g', status: 'not_started', session_id: null },
  ],
}

function mountView() { return mount(SubjectOverview, { props: { id: 's1' } }) }

describe('SubjectOverview', () => {
  beforeEach(() => { setActivePinia(createPinia()); push.mockClear() })

  it('shows a loading skeleton until the subject resolves (no blank flash)', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => {}) // never sets currentSubject
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="subject-overview-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subject-meta"]').exists()).toBe(false)
  })

  it('hides the loading skeleton once the subject is loaded', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="subject-overview-loading"]').exists()).toBe(false)
  })

  it('renders lesson rows with status and highlights the first non-done as next', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="subject-lesson-status-l1"]').text()).toContain('done')
    expect(wrapper.get('[data-testid="subject-lesson-next"]').attributes('data-testid')).toBe('subject-lesson-next')
    expect(wrapper.get('[data-testid="subject-lesson-next"]').text()).toContain('Reactions')
  })

  it('progress bar reflects done/total', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="subject-progress-bar"]').attributes('aria-valuenow')).toBe('2')
    expect(wrapper.get('[data-testid="subject-progress-bar"]').attributes('aria-valuemax')).toBe('3')
  })

  it('clicking a lesson opens it then navigates to the session', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    vi.spyOn(store, 'openLesson').mockResolvedValue('sess9')
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="subject-lesson-l3"]').trigger('click')
    await flushPromises()
    expect(store.openLesson).toHaveBeenCalledWith('l3')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'sess9' } })
  })

  it('Open next lesson opens the highlighted lesson', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    vi.spyOn(store, 'openLesson').mockResolvedValue('sess9')
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="subject-open-next"]').trigger('click')
    await flushPromises()
    expect(store.openLesson).toHaveBeenCalledWith('l3')
  })

  it('meta line reads duration_mode + pinned + derived from the backend (deadline)', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    const wrapper = mountView()
    await flushPromises()
    const meta = wrapper.get('[data-testid="subject-meta"]').text()
    expect(meta).toContain('30 min')   // per_session_minutes
    expect(meta).toContain('2-week')   // timeline_days/7 (pinned)
    expect(meta).toContain('3/week')   // pace_per_week (backend-derived, not recomputed)
  })

  it('meta line leads with pace when duration_mode is pace', async () => {
    const store = useSubjectStore()
    const paced = { ...overview, duration_mode: 'pace' }
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = paced })
    const wrapper = mountView()
    await flushPromises()
    const meta = wrapper.get('[data-testid="subject-meta"]').text()
    expect(meta).toContain('3/week')   // pace_per_week (pinned)
    expect(meta).toContain('2 weeks')  // derived finish horizon from backend
  })

  // --- dupe-banner session-state cross-ref tests ---

  it('dupe banner shows when two opened lessons share a title and both sessions are active', async () => {
    const subjectStore = useSubjectStore()
    const sessionStore = useSessionStore()
    const dupOverview = {
      ...overview,
      lessons: [
        { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
        { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess2' },
        { id: 'l3', subject_id: 's1', order_idx: 2, title: 'Reactions', goal: 'g', status: 'not_started', session_id: null },
      ],
    }
    vi.spyOn(subjectStore, 'loadSubject').mockImplementation(async () => { subjectStore.currentSubject = dupOverview })
    vi.spyOn(sessionStore, 'listSessions').mockImplementation(async () => {
      sessionStore.sessions = [{ id: 'sess1', ended_at: null }, { id: 'sess2', ended_at: null }]
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="subject-dupe-banner"]').exists()).toBe(true)
  })

  it('dupe banner is hidden when one of the two duplicate sessions is ended', async () => {
    const subjectStore = useSubjectStore()
    const sessionStore = useSessionStore()
    const dupOverview = {
      ...overview,
      lessons: [
        { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
        { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess2' },
      ],
    }
    vi.spyOn(subjectStore, 'loadSubject').mockImplementation(async () => { subjectStore.currentSubject = dupOverview })
    vi.spyOn(sessionStore, 'listSessions').mockImplementation(async () => {
      // sess2 is ended — only one active per topic, so no duplicate
      sessionStore.sessions = [
        { id: 'sess1', ended_at: null },
        { id: 'sess2', ended_at: '2026-06-29T00:00:00Z' },
      ]
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="subject-dupe-banner"]').exists()).toBe(false)
  })

  it('clicking dupe cleanup calls endSession for removable duplicate and reloads', async () => {
    const subjectStore = useSubjectStore()
    const sessionStore = useSessionStore()
    const dupOverview = {
      ...overview,
      lessons: [
        { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
        { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess2' },
      ],
    }
    const loadSubjectSpy = vi.spyOn(subjectStore, 'loadSubject').mockImplementation(async () => {
      subjectStore.currentSubject = dupOverview
    })
    const listSpy = vi.spyOn(sessionStore, 'listSessions').mockImplementation(async () => {
      sessionStore.sessions = [{ id: 'sess1', ended_at: null }, { id: 'sess2', ended_at: null }]
    })
    const endSpy = vi.spyOn(sessionStore, 'endSession').mockResolvedValue({})

    const wrapper = mountView()
    await flushPromises()

    // Clear onMounted call counts before triggering cleanup
    loadSubjectSpy.mockClear()
    listSpy.mockClear()

    await wrapper.get('[data-testid="subject-dupe-cleanup"]').trigger('click')
    await flushPromises()

    // l2 (order_idx 1) is the removable duplicate; l1 (order_idx 0) is kept
    expect(endSpy).toHaveBeenCalledWith('sess2')
    expect(loadSubjectSpy).toHaveBeenCalled()
    expect(listSpy).toHaveBeenCalled()
  })
})

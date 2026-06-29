import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/subjectsApi.js', () => ({
  draftPlan: vi.fn(), listSubjects: vi.fn(), getSubject: vi.fn(), createSubject: vi.fn(),
  addLesson: vi.fn(), patchLesson: vi.fn(), deleteLesson: vi.fn(), openLesson: vi.fn(),
}))

import { useSubjectStore } from '@/stores/subject.js'
import { derivePace, deriveHorizonWeeks } from '@/utils/pace.js'
import * as api from '@/services/subjectsApi.js'

const overview = {
  id: 's1', title: 'Organic Chemistry', per_session_minutes: 30,
  duration_mode: 'deadline', timeline_days: 14, pace_per_week: 3,
  archived_at: null, progress: { done_count: 2, total_count: 6 },
  lessons: [
    { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
    { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Alkanes', goal: 'g', status: 'done', session_id: 'sess2' },
    { id: 'l3', subject_id: 's1', order_idx: 2, title: 'Reactions', goal: 'g', status: 'not_started', session_id: null },
  ],
}

describe('subject store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
  })

  it('loadSubject stores the overview and exposes nextLesson (first non-done)', async () => {
    api.getSubject.mockResolvedValue(overview)
    const store = useSubjectStore()
    await store.loadSubject('s1')
    expect(store.currentSubject.title).toBe('Organic Chemistry')
    expect(store.nextLesson.id).toBe('l3')
  })

  it('openLesson returns session_id', async () => {
    api.openLesson.mockResolvedValue({ session_id: 'sess9' })
    const store = useSubjectStore()
    const sid = await store.openLesson('l3')
    expect(api.openLesson).toHaveBeenCalledWith('l3')
    expect(sid).toBe('sess9')
  })

  it('markLessonDone patches status=done and updates local lesson', async () => {
    api.getSubject.mockResolvedValue(overview)
    api.patchLesson.mockResolvedValue({ id: 'l3', status: 'done' })
    const store = useSubjectStore()
    await store.loadSubject('s1')
    await store.markLessonDone('l3')
    expect(api.patchLesson).toHaveBeenCalledWith('l3', { status: 'done' })
    expect(store.currentSubject.lessons.find((l) => l.id === 'l3').status).toBe('done')
  })

  it('draftPlan returns the lessons array from the preview response', async () => {
    api.draftPlan.mockResolvedValue({ lessons: [{ title: 'Bonding', goal: 'g' }, { title: 'Alkanes', goal: 'g' }] })
    const store = useSubjectStore()
    const lessons = await store.draftPlan({ title: 'Chem', per_session_minutes: 30, timeline_days: 14 })
    expect(api.draftPlan).toHaveBeenCalledWith({ title: 'Chem', per_session_minutes: 30, timeline_days: 14 })
    expect(lessons).toHaveLength(2)
    expect(lessons[0].title).toBe('Bonding')
  })

  it('derivePace floors weeks at 1 (By deadline)', () => {
    expect(derivePace(4, 3)).toBe(4) // 3 days -> weeks clamped to 1
    expect(derivePace(6, 14)).toBe(3) // 6 lessons / 2 weeks
    expect(derivePace(0, 14)).toBe(0)
  })

  it('deriveHorizonWeeks floors pace at 1 (By pace)', () => {
    expect(deriveHorizonWeeks(6, 3)).toBe(2) // 6 lessons at 3/week -> 2 weeks
    expect(deriveHorizonWeeks(5, 0)).toBe(5) // pace clamped to 1
    expect(deriveHorizonWeeks(0, 3)).toBe(0)
  })
})

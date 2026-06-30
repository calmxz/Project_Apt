import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useSubjectStore } from '@/stores/subject.js'
import * as subjectsApi from '@/services/subjectsApi.js'

function seed(store) {
  store.currentSubject = {
    id: 'sub1',
    title: 'Organic Chemistry',
    lessons: [
      { id: 'l0', order_idx: 0, title: 'Bonding', goal: 'g0', status: 'done', session_id: 's0' },
      { id: 'l1', order_idx: 1, title: 'Alkanes', goal: 'g1', status: 'not_started', session_id: null },
    ],
  }
}

describe('subject store — plan revision', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('addLessonAfter inserts after the given index and rewrites order_idx contiguously', async () => {
    const store = useSubjectStore()
    seed(store)
    vi.spyOn(subjectsApi, 'addLesson').mockResolvedValue({
      id: 'l2', order_idx: 2, title: 'Alkane practice', goal: 'gp', status: 'not_started', session_id: null,
    })
    const patch = vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})

    await store.addLessonAfter('sub1', 0, { title: 'Alkane practice', goal: 'gp' })

    const titles = store.currentSubject.lessons.map((l) => l.title)
    expect(titles).toEqual(['Bonding', 'Alkane practice', 'Alkanes'])
    const idxs = store.currentSubject.lessons.map((l) => l.order_idx)
    expect(idxs).toEqual([0, 1, 2]) // contiguous, no duplicates
    // new lesson (created at end, idx 2) and the displaced lesson get order_idx PATCHes
    expect(patch).toHaveBeenCalledWith('l2', { order_idx: 1 })
    expect(patch).toHaveBeenCalledWith('l1', { order_idx: 2 })
  })

  it('moveLesson down swaps order_idx and persists both rows', async () => {
    const store = useSubjectStore()
    seed(store)
    const patch = vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
    await store.moveLesson('l0', 1) // move l0 down to index 1
    expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l1', 'l0'])
    expect(store.currentSubject.lessons.map((l) => l.order_idx)).toEqual([0, 1])
    expect(patch).toHaveBeenCalledWith('l0', { order_idx: 1 })
    expect(patch).toHaveBeenCalledWith('l1', { order_idx: 0 })
  })

  it('moveLesson is a no-op for an out-of-range toIdx', async () => {
    const store = useSubjectStore()
    seed(store)
    const patch = vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})

    await store.moveLesson('l0', -1)
    await store.moveLesson('l0', 5)

    expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l0', 'l1'])
    expect(store.currentSubject.lessons.map((l) => l.order_idx)).toEqual([0, 1])
    expect(patch).not.toHaveBeenCalled()
  })

  it('renameLesson and editLessonGoal patch and update local state', async () => {
    const store = useSubjectStore()
    seed(store)
    vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
    await store.renameLesson('l1', 'Alkanes & isomers')
    await store.editLessonGoal('l1', 'new goal')
    const l1 = store.currentSubject.lessons.find((l) => l.id === 'l1')
    expect(l1.title).toBe('Alkanes & isomers')
    expect(l1.goal).toBe('new goal')
    expect(subjectsApi.patchLesson).toHaveBeenCalledWith('l1', { title: 'Alkanes & isomers' })
    expect(subjectsApi.patchLesson).toHaveBeenCalledWith('l1', { goal: 'new goal' })
  })

  it('removeLesson deletes an unopened lesson and reindexes', async () => {
    const store = useSubjectStore()
    seed(store)
    const del = vi.spyOn(subjectsApi, 'deleteLesson').mockResolvedValue({})
    vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
    await store.removeLesson('l1') // l1 has session_id null -> no force
    expect(del).toHaveBeenCalledWith('l1', { force: false })
    expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l0'])
    expect(store.currentSubject.lessons[0].order_idx).toBe(0)
  })

  it('removeLesson with force=true end-detaches-deletes a lesson that has a session', async () => {
    const store = useSubjectStore()
    seed(store)
    const del = vi.spyOn(subjectsApi, 'deleteLesson').mockResolvedValue({})
    vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
    await store.removeLesson('l0', { force: true }) // l0 has session_id 's0'
    expect(del).toHaveBeenCalledWith('l0', { force: true })
    expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l1'])
    expect(store.currentSubject.lessons[0].order_idx).toBe(0)
  })

  it('removeLesson leaves local state intact when the delete fails', async () => {
    const store = useSubjectStore()
    seed(store)
    vi.spyOn(subjectsApi, 'deleteLesson').mockRejectedValue(new Error('boom'))
    await expect(store.removeLesson('l0')).rejects.toThrow('boom')
    expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l0', 'l1'])
  })
})

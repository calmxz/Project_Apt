import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPatch = vi.fn()
const apiDelete = vi.fn()
vi.mock('@/services/apiClient.js', () => ({
  apiGet: (...a) => apiGet(...a),
  apiPost: (...a) => apiPost(...a),
  apiPatch: (...a) => apiPatch(...a),
  apiDelete: (...a) => apiDelete(...a),
}))

import * as api from '@/services/subjectsApi.js'

describe('subjectsApi', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset(); apiDelete.mockReset()
  })

  it('draftPlan posts the deadline-mode payload verbatim (no mode/lessons)', () => {
    api.draftPlan({ title: 'Organic Chemistry', per_session_minutes: 30, duration_mode: 'deadline', timeline_days: 14 })
    expect(apiPost).toHaveBeenCalledWith('/subjects/draft-plan', {
      title: 'Organic Chemistry', per_session_minutes: 30, duration_mode: 'deadline', timeline_days: 14,
    })
  })

  it('createSubject posts the pace-mode body verbatim (pace_per_week, no timeline_days)', () => {
    api.createSubject({ title: 'Organic Chemistry', per_session_minutes: 30, duration_mode: 'pace', pace_per_week: 3, mode: 'blank', lessons: [{ title: 'Bonding', goal: 'Get bonds' }] })
    expect(apiPost).toHaveBeenCalledWith('/subjects', {
      title: 'Organic Chemistry', per_session_minutes: 30, duration_mode: 'pace', pace_per_week: 3, mode: 'blank', lessons: [{ title: 'Bonding', goal: 'Get bonds' }],
    })
  })

  it('listSubjects gets /subjects', () => {
    api.listSubjects()
    expect(apiGet).toHaveBeenCalledWith('/subjects')
  })

  it('getSubject gets /subjects/:id', () => {
    api.getSubject('s1')
    expect(apiGet).toHaveBeenCalledWith('/subjects/s1')
  })

  it('patchSubject patches /subjects/:id', () => {
    api.patchSubject('s1', { title: 'New' })
    expect(apiPatch).toHaveBeenCalledWith('/subjects/s1', { title: 'New' })
  })

  it('addLesson posts to /subjects/:id/lessons', () => {
    api.addLesson('s1', { title: 'Alkanes', goal: 'Name them' })
    expect(apiPost).toHaveBeenCalledWith('/subjects/s1/lessons', { title: 'Alkanes', goal: 'Name them' })
  })

  it('patchLesson patches /lessons/:id', () => {
    api.patchLesson('l1', { status: 'done' })
    expect(apiPatch).toHaveBeenCalledWith('/lessons/l1', { status: 'done' })
  })

  it('deleteLesson deletes /lessons/:id', () => {
    api.deleteLesson('l1')
    expect(apiDelete).toHaveBeenCalledWith('/lessons/l1')
  })

  it('openLesson posts to /lessons/:id/open', () => {
    api.openLesson('l1')
    expect(apiPost).toHaveBeenCalledWith('/lessons/l1/open', {})
  })
})

import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is resolved from the Authorization: Bearer <jwt> header.

// Preview-only: generates a draft lesson list without persisting. The wizard
// loads the result into the same in-memory review/edit step the blank path uses.
// Pass-through: the wizard builds the body (duration_mode + exactly one of
// timeline_days / pace_per_week), so this forwards it verbatim.
export const draftPlan = (payload) => apiPost('/subjects/draft-plan', payload)

export const createSubject = (payload) => apiPost('/subjects', payload)

export const listSubjects = () => apiGet('/subjects')

export const getSubject = (subjectId) => apiGet(`/subjects/${subjectId}`)

export const patchSubject = (subjectId, patch) => apiPatch(`/subjects/${subjectId}`, patch)

export const addLesson = (subjectId, { title, goal }) =>
  apiPost(`/subjects/${subjectId}/lessons`, { title, goal })

export const patchLesson = (lessonId, patch) => apiPatch(`/lessons/${lessonId}`, patch)

export const deleteLesson = (lessonId) => apiDelete(`/lessons/${lessonId}`)

export const openLesson = (lessonId) => apiPost(`/lessons/${lessonId}/open`, {})

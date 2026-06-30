import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is resolved from the Authorization: Bearer <jwt> header.

export const createSubject = (payload) => apiPost('/subjects', payload)

export const listSubjects = () => apiGet('/subjects')

export const getSubject = (subjectId) => apiGet(`/subjects/${subjectId}`)

export const patchSubject = (subjectId, patch) => apiPatch(`/subjects/${subjectId}`, patch)

export const addLesson = (subjectId, { title, goal }) =>
  apiPost(`/subjects/${subjectId}/lessons`, { title, goal })

export const patchLesson = (lessonId, patch) => apiPatch(`/lessons/${lessonId}`, patch)

export const deleteLesson = (lessonId, { force = false } = {}) =>
  apiDelete(`/lessons/${lessonId}${force ? '?force=true' : ''}`)

export const openLesson = (lessonId) => apiPost(`/lessons/${lessonId}/open`, {})

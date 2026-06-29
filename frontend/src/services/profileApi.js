import { apiGet } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is resolved from the Authorization header server-side.
export const getSessionProfile = (sessionId) => apiGet(`/profile/${sessionId}`)

export const getAggregateProfile = () => apiGet('/profile/aggregate')

export const getSubjectProfile = (subjectId) => apiGet(`/subjects/${subjectId}/profile`)

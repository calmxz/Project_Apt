import { apiGet } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api prefix.
export const getSessionProfile = (sessionId) => apiGet(`/profile/${sessionId}`)

export const getAggregateProfile = (userId) =>
  apiGet('/profile/aggregate', { user_id: userId })

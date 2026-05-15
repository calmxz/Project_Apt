import { apiGet, apiPost } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api prefix.
export const createSession = ({ userId, topic, seedMode, priorSessionId }) =>
  apiPost('/sessions', {
    user_id: userId,
    topic,
    seed_mode: seedMode,
    prior_session_id: priorSessionId ?? null,
  })

export const listSessions = (userId) => apiGet('/sessions', { user_id: userId })

export const getSession = (sessionId) => apiGet(`/sessions/${sessionId}`)

export const endSession = (sessionId) => apiPost(`/sessions/${sessionId}/end`, {})

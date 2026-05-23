import { apiGet, apiPost } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is no longer carried in any payload — the backend resolves
// it from the Authorization: Bearer <jwt> header.
export const createSession = ({ topic, seedMode, priorSessionId }) =>
  apiPost('/sessions', {
    topic,
    seed_mode: seedMode,
    prior_session_id: priorSessionId ?? null,
  })

export const listSessions = () => apiGet('/sessions')

export const getSession = (sessionId) => apiGet(`/sessions/${sessionId}`)

export const endSession = (sessionId) => apiPost(`/sessions/${sessionId}/end`, {})

export const reopenSession = (sessionId) => apiPost(`/sessions/${sessionId}/reopen`, {})

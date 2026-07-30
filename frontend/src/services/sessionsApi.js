import { apiGet, apiPost, apiPatch } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is no longer carried in any payload — the backend resolves
// it from the Authorization: Bearer <jwt> header.
export const createSession = ({ topic, seedMode, priorSessionId, declaredLevel }) =>
  apiPost('/sessions', {
    topic,
    seed_mode: seedMode,
    prior_session_id: priorSessionId ?? null,
    declared_level: declaredLevel ?? null,
  })

// Start-page prior-topic intercept lookup; silent since a failed lookup must
// never block session creation or surface an error toast.
export const lookupTopic = (topic) => apiGet('/sessions/lookup', { topic }, { silent: true })

// U-05: every current caller (HomeView, Sidebar, NewSessionView) fires this
// from onMounted as a fire-and-forget background load -- none is a
// user-initiated action -- so silencing it here at the wrapper is
// unconditional and race-proof against the store's in-flight de-dupe
// (session.js:listSessions), unlike threading an opts flag through from one
// call site, which the de-dupe could silently drop if a different caller's
// non-silent call wins the race and gets shared.
export const listSessions = () => apiGet('/sessions', undefined, { silent: true })

// params: { status?: 'all'|'active'|'ended', q?: string,
//           sort?: 'last_activity'|'created'|'topic'|'pinned_activity', limit?: number, offset?: number }
export const getSessionLibrary = (params, opts) => apiGet('/sessions/library', params, opts)

export const getSession = (sessionId) => apiGet(`/sessions/${sessionId}`)

// P3: SessionView shows its own inline error/loading for the "load earlier"
// button; silent stops the errorBus double-toast (same opt-out pattern as
// skipCheck/answerCheck below).
export const getSessionMessages = (sessionId, params = {}) =>
  apiGet(`/sessions/${sessionId}/messages`, params, { silent: true })

export const endSession = (sessionId) => apiPost(`/sessions/${sessionId}/end`, {})

export const reopenSession = (sessionId) => apiPost(`/sessions/${sessionId}/reopen`, {})

export const renameSession = (sessionId, topic) => apiPatch(`/sessions/${sessionId}`, { topic })

export const setPinned = (sessionId, pinned) => apiPatch(`/sessions/${sessionId}`, { pinned })

// F-20: SessionView banners these failures itself (lastError); silent stops
// the errorBus double-toast - same opt-out pattern as profileApi.
export const skipCheck = (sessionId, index) =>
  apiPost(`/sessions/${sessionId}/check/skip`, { index }, { silent: true })

export const answerCheck = (sessionId, index, selectedIndex) =>
  apiPost(
    `/sessions/${sessionId}/check/answer`,
    {
      index,
      selected_index: selectedIndex,
    },
    { silent: true },
  )

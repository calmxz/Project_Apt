import { apiDelete, apiGet, apiPatch } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is resolved from the Authorization header server-side.
export const getSessionProfile = (sessionId) => apiGet(`/profile/${sessionId}`)

// H1: default every contract array key so a malformed/partial {} or null
// response from the backend can't throw in render (e.g.
// `data.combined_mastered_concepts.length`) inside ProfileTab/ProfileView.
const normalizeAggregateProfile = (res) => ({
  ...res,
  combined_mastered_concepts: res?.combined_mastered_concepts ?? [],
  combined_confirmed_gaps: res?.combined_confirmed_gaps ?? [],
  recent_topics: res?.recent_topics ?? [],
  concept_accuracy: res?.concept_accuracy ?? [],
  weekly_mastery: res?.weekly_mastery ?? [],
})

export const getAggregateProfile = () =>
  apiGet('/profile/aggregate').then(normalizeAggregateProfile)

export const getUsageSummary = () => apiGet('/usage/summary')

// Both write calls send If-Match so the server can enforce optimistic
// concurrency against the profile's current etag. Callers must pass the
// etag from the most recent GET (or the previous write's response).
//
// silent: true -- ProfileView's own write handler (_applyWrite) is the sole
// error surface (conflict notice on 412, inline banner otherwise). Without
// it, request()/errorBus would auto-toast every non-2xx AND the component
// would show its own message (double signal).
export const patchProfile = (sessionId, body, etag) =>
  apiPatch(`/profile/${sessionId}`, body, { headers: { 'If-Match': etag }, silent: true })

export const deleteProfileItem = (sessionId, listName, item, etag) =>
  apiDelete(`/profile/${sessionId}/${listName}/${encodeURIComponent(item)}`, {
    headers: { 'If-Match': etag },
    silent: true,
  })

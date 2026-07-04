import { apiDelete, apiGet, apiPatch } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is resolved from the Authorization header server-side.
export const getSessionProfile = (sessionId) => apiGet(`/profile/${sessionId}`)

export const getAggregateProfile = () => apiGet('/profile/aggregate')

// Both write calls send If-Match so the server can enforce optimistic
// concurrency against the profile's current etag. Callers must pass the
// etag from the most recent GET (or the previous write's response).
export const patchProfile = (sessionId, body, etag) =>
  apiPatch(`/profile/${sessionId}`, body, { headers: { 'If-Match': etag } })

export const deleteProfileItem = (sessionId, listName, item, etag) =>
  apiDelete(`/profile/${sessionId}/${listName}/${encodeURIComponent(item)}`, {
    headers: { 'If-Match': etag },
  })

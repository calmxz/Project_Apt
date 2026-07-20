// Maps ApiError instances (and plain Errors) to user-facing copy.
// Use in any error banner so we stop leaking raw `API <status> /path: <json>`.
export function friendlyError(err) {
  if (!err) return ''
  const status = typeof err === 'object' ? err.status : null
  if (status === 0) return "Can't reach the server. Check your connection and try again."
  if (status === 401 || status === 403) return "You're not signed in for this action."
  if (status === 404) return "We couldn't find that resource."
  if (status === 429) {
    // I-04: nginx's per-IP throttle also 429s but with a non-JSON body (no
    // detail.code). Only a coded envelope is the daily cap.
    if (err?.body?.detail?.code) return "You've hit the daily limit. Try again tomorrow."
    return 'Too many requests - wait a moment and retry.'
  }
  if (status === 503) return 'The tutor is temporarily unavailable. Try again in a moment.'
  if (typeof status === 'number' && status >= 500)
    return 'Something went wrong on our side. Try again shortly.'
  if (typeof status === 'number' && status >= 400)
    return 'That request was rejected. Check the details and try again.'
  if (err instanceof Error) return err.message
  return String(err)
}

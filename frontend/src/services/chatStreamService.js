import { parseSSEStream } from '@/lib/sseParser.js'
import { useAuthStore } from '@/stores/auth.js'
import { ApiError } from './apiClient.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

function _authToken() {
  try { return useAuthStore().accessToken ?? null } catch { return null }
}

export async function streamChat({ sessionId, message, onEvent, signal }) {
  const headers = { 'content-type': 'application/json' }
  const token = _authToken()
  if (token) headers['authorization'] = `Bearer ${token}`

  let resp
  try {
    resp = await fetch(`${BASE_URL}/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_id: sessionId, message }),
      signal,
    })
  } catch (e) {
    throw new ApiError(0, { detail: e.message }, '/chat/stream')
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let body
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    throw new ApiError(resp.status, body, '/chat/stream')
  }

  await parseSSEStream(resp.body, onEvent, { signal })
}

export async function streamCheckComplete({ sessionId, onEvent, signal }) {
  const headers = { 'content-type': 'application/json' }
  const token = _authToken()
  if (token) headers['authorization'] = `Bearer ${token}`

  let resp
  try {
    resp = await fetch(`${BASE_URL}/sessions/${sessionId}/check/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal,
    })
  } catch (e) {
    throw new ApiError(0, { detail: e.message }, '/check/complete')
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let body
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    throw new ApiError(resp.status, body, '/check/complete')
  }

  await parseSSEStream(resp.body, onEvent, { signal })
}

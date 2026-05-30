import { useAuthStore } from '../stores/auth.js'
import { ApiError, apiGet } from './apiClient.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

// Mirror of the backend cap (backend/routes/upload.py MAX_UPLOAD_BYTES). This is
// a client-side pre-check for instant feedback only; the backend remains the
// authoritative limit and still returns 413 FILE_TOO_LARGE if bypassed.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

function _authHeaders() {
  try {
    const store = useAuthStore()
    const token = store.accessToken
    return token ? { authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function uploadPdf({ sessionId, file }) {
  const fd = new FormData()
  fd.append('session_id', sessionId)
  fd.append('file', file)

  let resp
  try {
    resp = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: fd,
      headers: _authHeaders(),
    })
  } catch (e) {
    throw new ApiError(0, { detail: e.message }, '/upload')
  }

  const text = await resp.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* leave parsed null */
  }

  if (!resp.ok) throw new ApiError(resp.status, parsed ?? text, '/upload')
  return parsed
}

export const getUploadStatus = (documentId) => apiGet(`/upload/${documentId}`)

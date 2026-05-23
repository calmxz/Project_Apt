import { ApiError, apiGet } from './apiClient.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

export async function uploadPdf({ userId, sessionId, file }) {
  const fd = new FormData()
  fd.append('user_id', userId)
  fd.append('session_id', sessionId)
  fd.append('file', file)

  let resp
  try {
    resp = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: fd })
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

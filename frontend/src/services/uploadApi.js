import { ApiError, apiGet, apiDelete, getFreshAccessToken } from './apiClient.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

// Mirror of the backend cap (backend/routes/upload.py MAX_UPLOAD_BYTES). This is
// a client-side pre-check for instant feedback only; the backend remains the
// authoritative limit and still returns 413 FILE_TOO_LARGE if bypassed.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

export const ACCEPTED_EXTENSIONS = ['.pdf', '.pptx', '.txt', '.md', '.markdown']

// File-picker hint. `.markdown` is accepted by validateFile but omitted here so
// the picker advertises the common four; derived from ACCEPTED_EXTENSIONS so the
// two cannot silently drift when a type is added.
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.filter((ext) => ext !== '.markdown').join(',')

// Client-side pre-check only; the backend re-validates by extension and size.
export function validateFile(file) {
  const name = (file?.name || '').toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return {
      ok: false,
      reason: `${file?.name || 'File'} is not a supported type. Use PDF, PPTX, TXT, or MD.`,
    }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    return { ok: false, reason: `${file.name} is too large (max ${maxMb} MB).` }
  }
  return { ok: true }
}

async function _authHeaders() {
  const token = await getFreshAccessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function uploadDocument({ sessionId, file }) {
  const fd = new FormData()
  fd.append('session_id', sessionId)
  fd.append('file', file)

  let resp
  try {
    resp = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: fd,
      headers: await _authHeaders(),
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

/** @deprecated Back-compat alias for existing PDF-only call sites; use uploadDocument. */
export const uploadPdf = uploadDocument

export const getUploadStatus = (documentId) => apiGet(`/upload/${documentId}`)

export const getSessionIngestion = (sessionId) => apiGet(`/sessions/${sessionId}/ingestion`)

// silent: true — the banner's delete handler is the sole error surface. Without
// it, request()/errorBus would auto-toast non-404 failures AND the component's
// catch would toast again (double toast).
export const deleteDocument = (documentId) => apiDelete(`/documents/${documentId}`, { silent: true })

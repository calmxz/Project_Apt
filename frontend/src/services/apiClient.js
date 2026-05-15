// Set VITE_API_BASE_URL in frontend/.env or frontend/.env.local to override.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export class ApiError extends Error {
  constructor(status, body, path) {
    super(`API ${status} ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.path = path
  }
}

async function request(method, path, { body, params } = {}) {
  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
    ).toString()
    if (qs) url += `?${qs}`
  }

  const init = { method, headers: {} }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let resp
  try {
    resp = await fetch(url, init)
  } catch (e) {
    throw new ApiError(0, { detail: e.message }, path)
  }

  const text = await resp.text()
  const parsed = text ? safeJson(text) : null

  if (!resp.ok) throw new ApiError(resp.status, parsed ?? text, path)
  return parsed
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const apiGet = (path, params) => request('GET', path, { params })
export const apiPost = (path, body) => request('POST', path, { body })
export const apiPostForm = async (path, formData) => {
  const url = `${BASE_URL}${path}`
  let resp
  try {
    resp = await fetch(url, { method: 'POST', body: formData })
  } catch (e) {
    throw new ApiError(0, { detail: e.message }, path)
  }
  const text = await resp.text()
  const parsed = text ? safeJson(text) : null
  if (!resp.ok) throw new ApiError(resp.status, parsed ?? text, path)
  return parsed
}

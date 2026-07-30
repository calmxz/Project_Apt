import { useAuthStore } from '../stores/auth.js'
import { reportCostWarning } from './costBus.js'
import { reportApiError } from './errorBus.js'

// Set VITE_API_BASE_URL in frontend/.env or frontend/.env.local to override.
// Default mirrors uploadApi.js — backend routers all mount under /api.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

// F-06: a hung backend must not spin the UI forever. 30s covers the slowest
// legitimate JSON call (end-session runs a 20s-capped summary LLM call).
export const REQUEST_TIMEOUT_MS = 30000

export class ApiError extends Error {
  constructor(status, body, path) {
    super(`API ${status} ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.path = path
  }
}

// getSession() takes a navigator.locks lock inside supabase-js, so calling it
// per request serializes otherwise-parallel fetches. Reuse the cached store
// token while its exp is comfortably in the future; anything ambiguous (no
// token, opaque token, near/past expiry) falls through to the SDK.
const TOKEN_REFRESH_MARGIN_MS = 60000

function _tokenExpMs(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

// F-47: read the token from the SDK, not the Pinia snapshot. getSession()
// refreshes an expired access token; after wake-from-sleep the store can
// hold a stale one and would burn the single F-09 retry on a guaranteed 401.
// (Wake-from-sleep staleness means the token is past its exp, so the cheap
// exp check above never short-circuits that case.)
// Falls back to the store token (tests without a supabase env), then null.
export async function getFreshAccessToken() {
  try {
    const cached = useAuthStore().accessToken
    if (cached && _tokenExpMs(cached) - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return cached
    }
  } catch {
    // no active pinia -- fall through to the SDK path
  }
  try {
    const { getSupabase } = await import('./supabase.js')
    const { data } = await getSupabase().auth.getSession()
    const tok = data?.session?.access_token
    if (tok) return tok
  } catch {
    // fall through to the store snapshot
  }
  try {
    const store = useAuthStore()
    return store.accessToken ?? null
  } catch {
    return null
  }
}

// F-09: one refresh-then-retry on 401. getSession() refreshes an expired
// access token via the SDK; a second 401 means the session is truly dead --
// sign out and land on login instead of stranding a signed-in-looking UI.
export async function _refreshAccessToken() {
  try {
    const { getSupabase } = await import('./supabase.js')
    const { data } = await getSupabase().auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

export async function _onAuthExpired() {
  try {
    const store = useAuthStore()
    try {
      await store.signOut()
    } catch {
      // Supabase signOut failure must not block the local redirect.
    }
  } catch {
    // No active pinia (unit tests) -- nothing to sign out.
  }
  try {
    const { default: router } = await import('../router/index.js')
    // F-16: carry the location like the router guard does (F-49), so
    // re-login returns the user to where the expiry hit them.
    router.push({
      name: 'login',
      query: { redirect: router.currentRoute.value.fullPath },
    })
  } catch {
    // Router unavailable outside the app shell.
  }
}

async function request(
  method,
  path,
  { body, params, silent = false, headers } = {},
  _retried = false,
) {
  let url = `${BASE_URL}${path}`
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
    ).toString()
    if (qs) url += `?${qs}`
  }

  const init = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }

  const token = _retried ? await _refreshAccessToken() : await getFreshAccessToken()
  if (token) init.headers['authorization'] = `Bearer ${token}`

  let resp
  try {
    resp = await fetch(url, init)
  } catch (e) {
    const detail = e?.name === 'TimeoutError' ? 'request timed out' : e.message
    const err = new ApiError(0, { detail }, path)
    if (!silent) reportApiError(err)
    throw err
  }

  if (resp.status === 401 && !_retried) {
    // F-09: silent first 401 -- refresh and retry once before surfacing.
    return request(method, path, { body, params, silent, headers }, true)
  }

  const text = await resp.text()
  const parsed = text ? safeJson(text) : null

  if (!resp.ok) {
    if (resp.status === 401 && _retried) await _onAuthExpired()
    const err = new ApiError(resp.status, parsed ?? text, path)
    if (!silent) reportApiError(err)
    throw err
  }

  const warn = resp.headers?.get?.('x-cost-warning')
  if (warn) reportCostWarning({ header: warn, path })

  return parsed
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const apiGet = (path, params, opts = {}) => request('GET', path, { params, ...opts })
export const apiPost = (path, body, opts = {}) => request('POST', path, { body, ...opts })
export const apiPatch = (path, body, opts = {}) => request('PATCH', path, { body, ...opts })
export const apiDelete = (path, opts = {}) => request('DELETE', path, { ...opts })

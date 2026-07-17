import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, apiGet, apiPost } from '../services/apiClient.js'
import { errorBus } from '../services/errorBus.js'
import { useAuthStore } from '../stores/auth.js'

vi.mock('../router/index.js', () => ({ default: { push: vi.fn() } }))

describe('apiClient', () => {
  let listener
  let fetchMock
  beforeEach(() => {
    setActivePinia(createPinia())
    listener = vi.fn()
    errorBus.addEventListener('api-error', listener)
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
  })
  afterEach(() => {
    errorBus.removeEventListener('api-error', listener)
    vi.restoreAllMocks()
  })

  function jsonResp(status, body) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }

  it('apiGet parses JSON on 200', async () => {
    fetchMock.mockReturnValueOnce(jsonResp(200, { ok: true }))
    const out = await apiGet('/x')
    expect(out).toEqual({ ok: true })
    expect(listener).not.toHaveBeenCalled()
  })

  it('apiGet appends query string from params', async () => {
    fetchMock.mockReturnValueOnce(jsonResp(200, []))
    await apiGet('/x', { a: 1, b: null, c: 'k' })
    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('a=1')
    expect(url).toContain('c=k')
    expect(url).not.toContain('b=')
  })

  it('apiPost sends JSON body', async () => {
    fetchMock.mockReturnValueOnce(jsonResp(201, { id: 1 }))
    await apiPost('/x', { a: 1 })
    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ a: 1 })
  })

  it('throws ApiError and fires bus on non-2xx', async () => {
    fetchMock.mockReturnValueOnce(jsonResp(500, { detail: 'boom' }))
    await expect(apiGet('/x')).rejects.toBeInstanceOf(ApiError)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail.status).toBe(500)
  })

  it('throws ApiError(0) and fires bus on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const err = await apiGet('/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('silent: true suppresses bus on non-2xx', async () => {
    fetchMock.mockReturnValueOnce(jsonResp(404, { detail: 'nope' }))
    await expect(apiGet('/x', null, { silent: true })).rejects.toBeInstanceOf(ApiError)
    expect(listener).not.toHaveBeenCalled()
  })

  it('silent: true suppresses bus on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(apiPost('/x', {}, { silent: true })).rejects.toBeInstanceOf(ApiError)
    expect(listener).not.toHaveBeenCalled()
  })

  it('returns null for empty body', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }),
    )
    const out = await apiGet('/x')
    expect(out).toBeNull()
  })

  it('returns raw text in ApiError.body when response is not JSON', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('plain text') }),
    )
    const err = await apiGet('/x').catch((e) => e)
    expect(err.body).toBe('plain text')
  })

  it('sends an abort signal with each request', async () => {
    fetchMock.mockReturnValueOnce(jsonResp(200, {}))
    await apiGet('/ping')
    const init = fetchMock.mock.calls[0][1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps a timeout abort to a friendly ApiError', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('signal timed out', 'TimeoutError'))
    await expect(apiGet('/slow', undefined, { silent: true })).rejects.toMatchObject({
      status: 0,
      body: { detail: 'request timed out' },
    })
  })

  it('retries once with a refreshed token on 401 (F-09)', async () => {
    // First call is the pre-request getFreshAccessToken() lookup (F-47);
    // second is _refreshAccessToken() on the 401 retry.
    globalThis.__supabaseAuthStub.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({
        data: { session: { access_token: 'fresh-token', user: { id: 'u1' } } },
      })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"detail":"invalid_token"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiGet('/whatever')
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer fresh-token')
  })

  it('sends the getSession token, not the stale store token', async () => {
    const store = useAuthStore()
    store.session = { access_token: 'store-tok', user: { id: 'u1' } }
    globalThis.__supabaseAuthStub.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'fresh-tok', user: { id: 'u1' } } },
    })
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await apiGet('/ping')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['authorization']).toBe('Bearer fresh-tok')
  })

  it('falls back to the store token when getSession fails', async () => {
    const store = useAuthStore()
    store.session = { access_token: 'store-tok', user: { id: 'u1' } }
    globalThis.__supabaseAuthStub.getSession.mockRejectedValueOnce(new Error('offline'))
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await apiGet('/ping')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['authorization']).toBe('Bearer store-tok')
  })

  it('signs out and redirects to login after a second 401', async () => {
    const router = (await import('../router/index.js')).default
    globalThis.__supabaseAuthStub.getSession.mockResolvedValue({
      data: { session: { access_token: 'still-dead', user: { id: 'u1' } } },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"detail":"invalid_token"}', { status: 401 })),
    )

    await expect(apiGet('/whatever')).rejects.toMatchObject({ status: 401 })
    expect(globalThis.__supabaseAuthStub.signOut).toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith({ name: 'login' })
    expect(fetch).toHaveBeenCalledTimes(2) // hard cap: one retry
  })
})

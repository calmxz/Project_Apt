import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import * as sessionsApi from '@/services/sessionsApi.js'
import { postChat } from '@/services/chatApi.js'
import { getSessionProfile, getAggregateProfile } from '@/services/profileApi.js'
import { errorBus } from '@/services/errorBus.js'

describe('api wrappers', () => {
  let fetchMock
  let listener
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    listener = vi.fn()
    errorBus.addEventListener('api-error', listener)
  })
  afterEach(() => {
    errorBus.removeEventListener('api-error', listener)
    vi.restoreAllMocks()
  })

  function ok(body) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }

  // Phase 7: user_id is no longer carried in any payload — the backend
  // resolves it from the Authorization header.

  it('createSession posts topic + seed_mode (no user_id)', async () => {
    fetchMock.mockReturnValueOnce(ok({ id: 's1' }))
    await sessionsApi.createSession({ topic: 't', seedMode: 'm' })
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(init.body)
    expect(body.user_id).toBeUndefined()
    expect(body.topic).toBe('t')
    expect(body.seed_mode).toBe('m')
    expect(body.prior_session_id).toBeNull()
  })

  it('listSessions hits /sessions without user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok([]))
    await sessionsApi.listSessions()
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
  })

  it('getSession hits /sessions/:id without user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ id: 's1' }))
    await sessionsApi.getSession('s1')
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1')
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
  })

  it('endSession POSTs to /end without user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ ended_at: 'x' }))
    await sessionsApi.endSession('s1')
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1/end')
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('reopenSession POSTs to /reopen without user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ ok: true }))
    await sessionsApi.reopenSession('s1')
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1/reopen')
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
  })

  it('postChat sends session_id + message (no user_id)', async () => {
    fetchMock.mockReturnValueOnce(ok({ assistant_message: 'hi' }))
    await postChat({ sessionId: 's', message: 'm' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ session_id: 's', message: 'm' })
  })

  it('getSessionProfile hits /profile/:id without user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({}))
    await getSessionProfile('s1')
    expect(fetchMock.mock.calls[0][0]).toContain('/profile/s1')
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
  })

  it('getAggregateProfile hits /profile/aggregate without user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({}))
    await getAggregateProfile()
    expect(fetchMock.mock.calls[0][0]).toContain('/profile/aggregate')
    expect(fetchMock.mock.calls[0][0]).not.toContain('user_id=')
  })
})

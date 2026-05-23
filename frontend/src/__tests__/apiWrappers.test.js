import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import * as sessionsApi from '@/services/sessionsApi.js'
import { postChat } from '@/services/chatApi.js'
import { getSessionProfile, getAggregateProfile } from '@/services/profileApi.js'
import { errorBus } from '@/services/errorBus.js'

describe('api wrappers', () => {
  let fetchMock
  let listener
  beforeEach(() => {
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

  it('createSession posts user_id and topic', async () => {
    fetchMock.mockReturnValueOnce(ok({ id: 's1' }))
    await sessionsApi.createSession({ userId: 'u', topic: 't', seedMode: 'm' })
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(init.body)
    expect(body.user_id).toBe('u')
    expect(body.topic).toBe('t')
    expect(body.seed_mode).toBe('m')
    expect(body.prior_session_id).toBeNull()
  })

  it('listSessions appends user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok([]))
    await sessionsApi.listSessions('u1')
    expect(fetchMock.mock.calls[0][0]).toContain('user_id=u1')
  })

  it('getSession hits /sessions/:id with user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ id: 's1' }))
    await sessionsApi.getSession('s1', 'u1')
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1')
    expect(fetchMock.mock.calls[0][0]).toContain('user_id=u1')
  })

  it('endSession POSTs to /end with user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ ended_at: 'x' }))
    await sessionsApi.endSession('s1', 'u1')
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1/end')
    expect(fetchMock.mock.calls[0][0]).toContain('user_id=u1')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('reopenSession POSTs to /reopen with user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({ ok: true }))
    await sessionsApi.reopenSession('s1', 'u1')
    expect(fetchMock.mock.calls[0][0]).toContain('/sessions/s1/reopen')
    expect(fetchMock.mock.calls[0][0]).toContain('user_id=u1')
  })

  it('postChat sends session_id, user_id, message', async () => {
    fetchMock.mockReturnValueOnce(ok({ assistant_message: 'hi' }))
    await postChat({ sessionId: 's', userId: 'u', message: 'm' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ session_id: 's', user_id: 'u', message: 'm' })
  })

  it('getSessionProfile hits /profile/:id with user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({}))
    await getSessionProfile('s1', 'u1')
    expect(fetchMock.mock.calls[0][0]).toContain('/profile/s1')
    expect(fetchMock.mock.calls[0][0]).toContain('user_id=u1')
  })

  it('getAggregateProfile passes user_id query', async () => {
    fetchMock.mockReturnValueOnce(ok({}))
    await getAggregateProfile('u1')
    expect(fetchMock.mock.calls[0][0]).toContain('/profile/aggregate?user_id=u1')
  })
})

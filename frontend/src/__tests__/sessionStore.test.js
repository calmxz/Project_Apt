import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/sessionsApi.js', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  endSession: vi.fn(),
  reopenSession: vi.fn(),
}))
vi.mock('@/services/chatApi.js', () => ({ postChat: vi.fn() }))

import { useSessionStore } from '@/stores/session.js'
import * as sessionsApi from '@/services/sessionsApi.js'
import { postChat } from '@/services/chatApi.js'
import { ERR_DAILY_CAP_REACHED } from '@/lib/errorCodes.js'

class ApiErrorLike extends Error {
  constructor(status, body) {
    super('api error')
    this.status = status
    this.body = body
  }
}

describe('session store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('listSessions populates and clears loading/error', async () => {
    sessionsApi.listSessions.mockResolvedValueOnce([{ id: 's1' }])
    const s = useSessionStore()
    const out = await s.listSessions('u1')
    expect(out).toEqual([{ id: 's1' }])
    expect(s.sessions).toEqual([{ id: 's1' }])
    expect(s.loading).toBe(false)
  })

  it('listSessions surfaces error and rethrows', async () => {
    sessionsApi.listSessions.mockRejectedValueOnce(new Error('nope'))
    const s = useSessionStore()
    await expect(s.listSessions('u1')).rejects.toThrow('nope')
    expect(s.error).toBe('nope')
  })

  it('createSession sets currentSession and resets messages', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({ id: 's2', topic: 't' })
    const s = useSessionStore()
    s.messages = [{ role: 'user', content: 'old' }]
    const out = await s.createSession({ userId: 'u', topic: 't' })
    expect(out.id).toBe('s2')
    expect(s.currentSessionId).toBe('s2')
    expect(s.messages).toEqual([])
  })

  it('loadSession maps API messages to flat list', async () => {
    sessionsApi.getSession.mockResolvedValueOnce({
      id: 's1',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', citations: [], created_at: '2026-01-01' },
        { id: 'm2', role: 'assistant', content: 'hey', created_at: '2026-01-02' },
      ],
    })
    const s = useSessionStore()
    await s.loadSession('s1')
    expect(s.messages).toHaveLength(2)
    expect(s.messages[0].message_id).toBe('m1')
    expect(s.messages[1].citations).toEqual([])
  })

  it('sendMessage rejects without an active session', async () => {
    const s = useSessionStore()
    await expect(s.sendMessage({ userId: 'u', text: 'x' })).rejects.toThrow(
      'no active session',
    )
  })

  it('sendMessage returns null when text is empty', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({ id: 's1', topic: 't' })
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    const out = await s.sendMessage({ userId: 'u', text: '  ' })
    expect(out).toBeNull()
  })

  it('sendMessage appends assistant reply on success', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({ id: 's1', topic: 't' })
    postChat.mockResolvedValueOnce({
      assistant_message: 'hi',
      message_id: 'm1',
      citations: [{ doc_id: 'd1', text: 't' }],
      tool_calls: [],
    })
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    await s.sendMessage({ userId: 'u', text: 'hello' })
    expect(s.messages).toHaveLength(2)
    expect(s.messages[1].role).toBe('assistant')
    expect(s.messages[1].citations[0].doc_id).toBe('d1')
  })

  it('sendMessage captures daily cap info on 429', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({ id: 's1', topic: 't' })
    postChat.mockRejectedValueOnce(
      new ApiErrorLike(429, {
        detail: { code: ERR_DAILY_CAP_REACHED, cap: 10, used: 10, resets_at: '2026-01-02' },
      }),
    )
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    await expect(s.sendMessage({ userId: 'u', text: 'x' })).rejects.toThrow('api error')
    expect(s.dailyCapReached).toBe(true)
    expect(s.dailyCapInfo.cap).toBe(10)
    s.clearDailyCap()
    expect(s.dailyCapReached).toBe(false)
  })

  it('endSession updates currentSession ended_at', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({ id: 's1', topic: 't' })
    sessionsApi.endSession.mockResolvedValueOnce({
      ended_at: '2026-01-01',
      summary: { text: 'recap' },
    })
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    const resp = await s.endSession()
    expect(resp.summary.text).toBe('recap')
    expect(s.currentSession.ended_at).toBe('2026-01-01')
  })

  it('reopenSession clears ended_at when ids match', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({
      id: 's1',
      topic: 't',
      ended_at: '2026-01-01',
    })
    sessionsApi.reopenSession.mockResolvedValueOnce({ ok: true })
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    await s.reopenSession('s1')
    expect(s.currentSession.ended_at).toBeNull()
  })

  it('setError and reset work', () => {
    const s = useSessionStore()
    s.setError('boom')
    expect(s.error).toBe('boom')
    s.reset()
    expect(s.error).toBeNull()
    expect(s.currentSessionId).toBeNull()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/sessionsApi.js', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  endSession: vi.fn(),
  reopenSession: vi.fn(),
  getSessionLibrary: vi.fn(),
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

  it('fetchLibrary returns the page and toggles libraryLoading', async () => {
    const page = { items: [{ id: 's1' }], total: 1, limit: 20, offset: 0 }
    sessionsApi.getSessionLibrary.mockResolvedValueOnce(page)
    const s = useSessionStore()
    const out = await s.fetchLibrary({ status: 'all', limit: 20, offset: 0 })
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith({ status: 'all', limit: 20, offset: 0 })
    expect(out).toEqual(page)
    expect(s.libraryLoading).toBe(false)
    expect(s.libraryError).toBeNull()
  })

  it('fetchLibrary records error and rethrows', async () => {
    sessionsApi.getSessionLibrary.mockRejectedValueOnce(new Error('boom'))
    const s = useSessionStore()
    await expect(s.fetchLibrary({})).rejects.toThrow('boom')
    expect(s.libraryError).toBeTruthy()
    expect(s.libraryLoading).toBe(false)
  })
})

import * as streamSvc from '../services/chatStreamService.js'

describe('session store — streaming', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('starts in idle stream state with no streaming message', () => {
    const s = useSessionStore()
    expect(s.streamState).toBe('idle')
    expect(s.streamingMessage).toBeNull()
  })

  it('appendAssistantDelta accumulates text on streamingMessage', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    s.appendAssistantDelta('Hello ')
    s.appendAssistantDelta('world')
    expect(s.streamingMessage.content).toBe('Hello world')
  })

  it('recordToolCall (start) appends to tool_calls and flips state', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.recordToolCall({ kind: 'start', tool_call: { id: 't1', name: 'retrieve_chunks' } })
    expect(s.streamState).toBe('tool_running')
    expect(s.streamingMessage.tool_calls).toHaveLength(1)
    expect(s.streamingMessage.tool_calls[0].state).toBe('running')
  })

  it('recordToolCall (done) marks chip done and returns to streaming', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: '', citations: [], tool_calls: [{ id: 't1', name: 'retrieve_chunks', state: 'running' }] }
    s.streamState = 'tool_running'
    s.recordToolCall({ kind: 'done', tool_call: { id: 't1', summary: '5 found' } })
    expect(s.streamingMessage.tool_calls[0].state).toBe('done')
    expect(s.streamingMessage.tool_calls[0].summary).toBe('5 found')
    expect(s.streamState).toBe('streaming')
  })

  it('finalizeMessage moves streamingMessage to messages[] and clears state', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'done', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.finalizeMessage('msg_xyz')
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'done', message_id: 'msg_xyz', status: 'complete' })
  })

  it('handleCancelled persists partial as status=cancelled', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'partial', tool_calls: [], citations: [] }
    s.streamState = 'stopping'
    s.handleCancelled('msg_x', 7, '0.0019')
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.messages.at(-1)).toMatchObject({ status: 'cancelled', content: 'partial' })
  })

  it('sendMessageStreaming wires through streamChat and dispatches events', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const spy = vi.spyOn(streamSvc, 'streamChat').mockImplementation(async ({ onEvent }) => {
      onEvent({ event: 'assistant_delta', data: { text: 'Hi' } })
      onEvent({ event: 'done', data: { message_id: 'm1' } })
    })
    await s.sendMessageStreaming({ text: 'q' })
    expect(spy).toHaveBeenCalled()
    expect(s.messages.at(-1)).toMatchObject({ message_id: 'm1' })
  })

  it('stopStream invokes abortController.abort() and transitions to stopping', () => {
    const s = useSessionStore()
    const abort = vi.fn()
    s.abortController = { abort }
    s.streamState = 'streaming'
    s.stopStream()
    expect(abort).toHaveBeenCalled()
    expect(s.streamState).toBe('stopping')
  })
})

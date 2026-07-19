import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/sessionsApi.js', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  endSession: vi.fn(),
  reopenSession: vi.fn(),
  getSessionLibrary: vi.fn(),
  renameSession: vi.fn(),
  setPinned: vi.fn(),
}))

import { useSessionStore } from '@/stores/session.js'
import * as sessionsApi from '@/services/sessionsApi.js'
import * as streamSvc from '@/services/chatStreamService.js'
import { ERR_DAILY_CAP_REACHED, ERR_DAILY_COST_CAP_REACHED } from '@/lib/errorCodes.js'

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

  // F-14 follow-up: reload must carry `status` through so a 'partial' row
  // renders its "(interrupted)" marker after a page refresh, not just live.
  it('loadSession maps status through so partial rows render on reload', async () => {
    sessionsApi.getSession.mockResolvedValueOnce({
      id: 's1',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          citations: [],
          created_at: '2026-01-01',
          status: 'complete',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'draft',
          created_at: '2026-01-02',
          status: 'partial',
        },
      ],
    })
    const s = useSessionStore()
    await s.loadSession('s1')
    expect(s.messages[1]).toMatchObject({ content: 'draft', status: 'partial' })
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

  // F-54: 'no_exchanges' summary.text is UI display copy for the closing
  // dialog, not a real recap -- it must not be written into topic_profile.
  it('endSession writes the profile summary when kind is summary', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({
      id: 's1',
      topic: 't',
      topic_profile: { last_session_summary: 'old' },
    })
    sessionsApi.endSession.mockResolvedValueOnce({
      ended_at: '2026-01-01',
      summary: { kind: 'summary', text: 'display copy' },
    })
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    await s.endSession()
    expect(s.currentSession.topic_profile.last_session_summary).toBe('display copy')
  })

  it('endSession does NOT write the profile summary when kind is no_exchanges', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({
      id: 's1',
      topic: 't',
      topic_profile: { last_session_summary: 'old' },
    })
    sessionsApi.endSession.mockResolvedValueOnce({
      ended_at: '2026-01-01',
      summary: { kind: 'no_exchanges', text: 'display copy' },
    })
    const s = useSessionStore()
    await s.createSession({ userId: 'u', topic: 't' })
    await s.endSession()
    expect(s.currentSession.topic_profile.last_session_summary).toBe('old')
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

  it('listSessions de-dupes concurrent calls into one network request', async () => {
    let resolve
    sessionsApi.listSessions.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const s = useSessionStore()
    const p1 = s.listSessions()
    const p2 = s.listSessions()
    resolve([{ id: 's1' }])
    const [r1, r2] = await Promise.all([p1, p2])
    expect(sessionsApi.listSessions).toHaveBeenCalledTimes(1)
    expect(r1).toEqual([{ id: 's1' }])
    expect(r2).toEqual([{ id: 's1' }])
    expect(s.detailLoading).toBe(false)
  })

  it('listSessions refetches after a failed request (error path clears inflight key)', async () => {
    sessionsApi.listSessions
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([{ id: 'b' }])
    const s = useSessionStore()
    await expect(s.listSessions()).rejects.toThrow('network')
    const out = await s.listSessions()
    expect(sessionsApi.listSessions).toHaveBeenCalledTimes(2)
    expect(out).toEqual([{ id: 'b' }])
  })

  it('listSessions refetches after the in-flight request settles (no retained cache)', async () => {
    sessionsApi.listSessions
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([{ id: 'b' }])
    const s = useSessionStore()
    await s.listSessions()
    await s.listSessions()
    expect(sessionsApi.listSessions).toHaveBeenCalledTimes(2)
    expect(s.sessions).toEqual([{ id: 'b' }])
  })

  it('loadSession de-dupes concurrent same-id calls and toggles detailLoading', async () => {
    let resolve
    sessionsApi.getSession.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const s = useSessionStore()
    const p1 = s.loadSession('s1')
    const p2 = s.loadSession('s1')
    expect(s.detailLoading).toBe(true)
    resolve({ id: 's1', messages: [] })
    await Promise.all([p1, p2])
    expect(sessionsApi.getSession).toHaveBeenCalledTimes(1)
    expect(s.detailLoading).toBe(false)
  })

  it('loadSession does not de-dupe different ids', async () => {
    sessionsApi.getSession.mockResolvedValue({ id: 'x', messages: [] })
    const s = useSessionStore()
    await Promise.all([s.loadSession('s1'), s.loadSession('s2')])
    expect(sessionsApi.getSession).toHaveBeenCalledTimes(2)
  })

  it('drops a superseded out-of-order load (A->B->A, B resolves last)', async () => {
    const resolvers = {}
    sessionsApi.getSession.mockImplementation(
      (id) =>
        new Promise((r) => {
          resolvers[id] = () => r({ id, messages: [] })
        }),
    )
    const s = useSessionStore()
    const pA1 = s.loadSession('A')
    const pB = s.loadSession('B')
    const pA2 = s.loadSession('A') // deduped onto the still-pending A load; re-stamps latest='A'
    resolvers['A']()
    resolvers['B']() // B resolves AFTER A, but A is the latest requested -> B must not clobber
    await Promise.all([pA1, pB, pA2])
    expect(s.currentSessionId).toBe('A')
    expect(s.currentSession.id).toBe('A')
  })

  it('a superseded load that 404s does not clobber the current session error', async () => {
    const slots = {}
    sessionsApi.getSession.mockImplementation(
      (id) =>
        new Promise((res, rej) => {
          slots[id] = { res, rej }
        }),
    )
    const s = useSessionStore()
    const pA = s.loadSession('A')
    const pB = s.loadSession('B') // latest requested -> B
    slots['B'].res({ id: 'B', messages: [] })
    // A 404s AFTER navigating to B; it must not surface an error over B.
    slots['A'].rej(Object.assign(new Error('gone'), { status: 404 }))
    await Promise.allSettled([pA, pB])
    expect(s.currentSession.id).toBe('B')
    expect(s.error).toBeNull()
  })

  it('a non-superseded 404 still surfaces the error (guard does not over-suppress)', async () => {
    sessionsApi.getSession.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
    const s = useSessionStore()
    await expect(s.loadSession('gone')).rejects.toBeTruthy()
    expect(s.error).toBeTruthy()
  })

  it('fetchLibrary returns the page and toggles libraryLoading', async () => {
    const page = { items: [{ id: 's1' }], total: 1, limit: 20, offset: 0 }
    sessionsApi.getSessionLibrary.mockResolvedValueOnce(page)
    const s = useSessionStore()
    const out = await s.fetchLibrary({ status: 'all', limit: 20, offset: 0 })
    expect(sessionsApi.getSessionLibrary).toHaveBeenCalledWith({
      status: 'all',
      limit: 20,
      offset: 0,
    })
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

  // F-07: renameSession/setPinned are background sidebar actions -- a failure
  // must roll back local state and rethrow for the caller to toast, but must
  // never write the store's global `error` (that unmounts unrelated screens,
  // e.g. Home, which treats a non-empty error as fatal).
  it('renameSession failure rolls back but does not write global error', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 's1', topic: 'Old' }]
    sessionsApi.renameSession.mockRejectedValue(new ApiErrorLike(500, {}))
    await expect(store.renameSession('s1', 'New')).rejects.toBeTruthy()
    expect(store.sessions[0].topic).toBe('Old')
    expect(store.error).toBeNull()
  })

  it('setPinned failure rolls back but does not write global error', async () => {
    const store = useSessionStore()
    store.sessions = [{ id: 's1', topic: 'Old', pinned: false }]
    sessionsApi.setPinned.mockRejectedValue(new ApiErrorLike(500, {}))
    await expect(store.setPinned('s1', true)).rejects.toBeTruthy()
    expect(store.sessions[0].pinned).toBe(false)
    expect(store.error).toBeNull()
  })
})

describe('session store — streaming', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

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
    s.streamingMessage = {
      role: 'assistant',
      content: '',
      citations: [],
      tool_calls: [{ id: 't1', name: 'retrieve_chunks', state: 'running' }],
    }
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
    expect(s.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'done',
      message_id: 'msg_xyz',
      status: 'complete',
    })
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

  // F-14 follow-up: the max_iters / mid-turn cost-cap abort arms persist
  // 'partial' on the backend; a generic agent-loop failure persists 'error'.
  // The live handler must match so reload doesn't show something different
  // from what was on screen mid-stream.
  it('handleAbortError pushes streamed text as status=partial for a cost-cap abort', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'draft', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.handleAbortError('daily_cost_cap_reached')
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.messages.at(-1)).toMatchObject({ status: 'partial', content: 'draft' })
  })

  it('handleAbortError pushes streamed text as status=partial for max_iters_reached', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'draft', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.handleAbortError('max_iters_reached')
    expect(s.messages.at(-1)).toMatchObject({ status: 'partial', content: 'draft' })
  })

  it('handleAbortError pushes streamed text as status=error for a generic llm failure', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: 'draft', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    s.handleAbortError('llm_failed')
    expect(s.messages.at(-1)).toMatchObject({ status: 'error', content: 'draft' })
  })

  it('handleAbortError does not push an empty bubble when nothing streamed yet', () => {
    const s = useSessionStore()
    s.streamingMessage = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    const before = s.messages.length
    s.handleAbortError('daily_cost_cap_reached')
    expect(s.messages.length).toBe(before)
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
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

  it('forwards reviewGaps to streamChat as review_gaps', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const spy = vi.spyOn(streamSvc, 'streamChat').mockResolvedValue(undefined)
    await s.sendMessageStreaming({ text: 'Review my gaps', reviewGaps: true })
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ reviewGaps: true, message: 'Review my gaps' }),
    )
  })

  it('forwards reviewGap to streamChat as review_gap', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const spy = vi.spyOn(streamSvc, 'streamChat').mockResolvedValue(undefined)
    await s.sendMessageStreaming({
      text: 'Review my gap: recursion',
      reviewGaps: true,
      reviewGap: 'recursion',
    })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ reviewGap: 'recursion' }))
  })

  it('continueTopic creates a resume session and marks the prior ended locally', async () => {
    sessionsApi.createSession.mockResolvedValueOnce({ id: 'new-1', topic: 'Calculus' })
    const s = useSessionStore()
    s.sessions = [{ id: 'old-1', topic: 'Calculus', ended_at: null }]
    const created = await s.continueTopic({ id: 'old-1', topic: 'Calculus' })
    expect(sessionsApi.createSession).toHaveBeenCalledWith({
      topic: 'Calculus',
      seedMode: 'resume',
      priorSessionId: 'old-1',
    })
    expect(created.id).toBe('new-1')
    expect(s.sessions.find((x) => x.id === 'old-1').ended_at).toBeTruthy()
  })

  it('sendMessageStreaming rejects without an active session', async () => {
    const s = useSessionStore()
    await expect(s.sendMessageStreaming({ text: 'x' })).rejects.toThrow('no active session')
  })

  it('sendMessageStreaming returns null when text is empty', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const out = await s.sendMessageStreaming({ text: '  ' })
    expect(out).toBeNull()
  })

  it('sendMessageStreaming appends citations and tool_calls from stream events on success', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(async ({ onEvent }) => {
      onEvent({ event: 'tool_call_start', data: { id: 't1', name: 'retrieve_chunks' } })
      onEvent({ event: 'tool_call_done', data: { id: 't1', summary: '5 found' } })
      onEvent({ event: 'assistant_delta', data: { text: 'hi' } })
      onEvent({ event: 'citations', data: [{ doc_id: 'd1', text: 't' }] })
      onEvent({ event: 'done', data: { message_id: 'm1' } })
    })
    await s.sendMessageStreaming({ text: 'hello' })
    expect(s.messages).toHaveLength(2)
    expect(s.messages[1].role).toBe('assistant')
    expect(s.messages[1].citations[0].doc_id).toBe('d1')
    expect(s.messages[1].tool_calls[0].summary).toBe('5 found')
  })

  // Streaming path now maps the 429 envelope into dailyCapInfo via
  // lib/capErrors.js (slice 2) -- parity with the removed non-streaming chain.
  it('sendMessageStreaming maps a daily-cap 429 into dailyCapInfo and store error', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockRejectedValueOnce(
      new ApiErrorLike(429, {
        detail: { code: ERR_DAILY_CAP_REACHED, cap: 10, used: 10, resets_at: '2026-01-02' },
      }),
    )
    await expect(s.sendMessageStreaming({ text: 'x' })).rejects.toThrow('api error')
    expect(s.error).toBeTruthy()
    expect(s.dailyCapInfo).toEqual({ cap: 10, used: 10, resets_at: '2026-01-02' })
    expect(s.dailyCapReached).toBe(true)
    expect(s.streamState).toBe('idle')
    expect(s.streamingMessage).toBeNull()
  })

  it('maps a session_ended 409 to a friendly error and marks the session ended', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    s.currentSession = { id: 's1', ended_at: null }
    vi.spyOn(streamSvc, 'streamChat').mockRejectedValueOnce(
      Object.assign(new Error('conflict'), {
        status: 409,
        body: { detail: { code: 'session_ended' } },
      }),
    )
    await s.sendMessageStreaming({ text: 'hello' })
    expect(s.error).toMatch(/ended/i)
    expect(s.streamState).toBe('idle')
    expect(s.currentSession.ended_at).not.toBeNull()
  })

  it('sendMessageStreaming maps a mid-turn SSE cost-cap error event into costCapInfo', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(async ({ onEvent }) => {
      onEvent({ event: 'assistant_delta', data: { text: 'partial' } })
      onEvent({
        event: 'error',
        data: {
          code: ERR_DAILY_COST_CAP_REACHED,
          used_usd: '3.0100',
          soft_cap_usd: '2.0',
          hard_cap_usd: '3.0',
        },
      })
    })
    await s.sendMessageStreaming({ text: 'x' })
    expect(s.costCapInfo).toEqual({
      used_usd: '3.0100',
      soft_cap_usd: '2.0',
      hard_cap_usd: '3.0',
      resets_at: null,
    })
    expect(s.costCapReached).toBe(true)
    expect(s.streamState).toBe('idle')
    // F-14 follow-up: the streamed text must survive onto the transcript,
    // not just clear the cap banner state.
    expect(s.messages.at(-1)).toMatchObject({ status: 'partial', content: 'partial' })
  })

  it('resets stream state when the stream ends without a terminal event', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(async ({ onEvent }) => {
      onEvent({ event: 'assistant_delta', data: { text: 'partial' } })
      // resolves without emitting done/cancelled/error -- simulates a dropped connection
    })
    await s.sendMessageStreaming({ text: 'hello' })
    expect(s.streamState).toBe('idle')
    expect(s.streamingMessage).toBeNull()
    expect(s.error).toBeTruthy()
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

  // F-04: both stream starters write through the shared streamingMessage /
  // abortController, so a second start while one is live would interleave
  // two SSE streams into a single bubble.
  it('completeCheck does not start while another stream is live (F-04)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    s.pendingCheck = { gap: 'g', total: 1, currentIndex: 1, viewIndex: 0, items: [] }
    s.streamingMessage = { role: 'assistant', content: 'live', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    const spy = vi.spyOn(streamSvc, 'streamCheckComplete').mockResolvedValue(undefined)
    await s.completeCheck()
    expect(spy).not.toHaveBeenCalled()
    expect(s.pendingCheck).not.toBeNull()
    expect(s.streamingMessage.content).toBe('live')
  })

  it('sendMessageStreaming refuses to start while another stream is live (F-04)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    s.streamState = 'streaming'
    const spy = vi.spyOn(streamSvc, 'streamChat').mockResolvedValue(undefined)
    const out = await s.sendMessageStreaming({ text: 'x' })
    expect(out).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  // F-01: a stream that outlives a session switch must not deliver its
  // output, errors, or notices into the session now being viewed.
  it('a stream that emits done after a session switch delivers nothing (F-01)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    let emit, finish
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(
      ({ onEvent }) =>
        new Promise((resolve) => {
          emit = onEvent
          finish = resolve
        }),
    )
    const p = s.sendMessageStreaming({ text: 'q' })
    emit({ event: 'assistant_delta', data: { text: 'late reply' } })
    s.currentSessionId = 's2' // user switched sessions mid-stream
    emit({ event: 'done', data: { message_id: 'm-late' } })
    finish()
    await p
    expect(s.messages.some((m) => m.message_id === 'm-late')).toBe(false)
    expect(s.messages.some((m) => m.role === 'assistant')).toBe(false)
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
  })

  it('a superseded stream error does not surface over the new session (F-01)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    let emit, finish
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(
      ({ onEvent }) =>
        new Promise((resolve) => {
          emit = onEvent
          finish = resolve
        }),
    )
    const p = s.sendMessageStreaming({ text: 'q' })
    s.currentSessionId = 's2'
    emit({ event: 'error', data: { code: 'llm_failed', message: 'boom' } })
    finish()
    await p
    expect(s.error).toBeNull()
    expect(s.messages.some((m) => m.role === 'assistant')).toBe(false)
    expect(s.streamState).toBe('idle')
  })

  it('abandonStream aborts silently without persisting a cancelled bubble (F-01)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(
      ({ signal }) =>
        new Promise((_res, rej) => {
          signal.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    )
    const p = s.sendMessageStreaming({ text: 'q' })
    s.abandonStream()
    await p
    expect(s.messages.some((m) => m.role === 'assistant')).toBe(false)
    expect(s.messages.some((m) => m.status === 'cancelled')).toBe(false)
    expect(s.error).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.streamingMessage).toBeNull()
  })

  it('loadSession to a different id abandons the in-flight stream (F-01)', async () => {
    sessionsApi.getSession.mockResolvedValueOnce({ id: 's2', messages: [] })
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const abort = vi.fn()
    s.abortController = { abort }
    s.streamingMessage = { role: 'assistant', content: 'x', tool_calls: [], citations: [] }
    s.streamState = 'streaming'
    await s.loadSession('s2')
    expect(abort).toHaveBeenCalled()
    expect(s.streamingMessage).toBeNull()
    expect(s.messages.some((m) => m.role === 'assistant')).toBe(false)
  })

  it('loadSession with the same id does not abort the in-flight stream', async () => {
    sessionsApi.getSession.mockResolvedValueOnce({ id: 's1', messages: [] })
    const s = useSessionStore()
    s.currentSessionId = 's1'
    const abort = vi.fn()
    s.abortController = { abort }
    await s.loadSession('s1')
    expect(abort).not.toHaveBeenCalled()
  })
})

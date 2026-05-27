// frontend/src/__tests__/chatStreamService.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { streamChat } from '@/services/chatStreamService.js'
import { useAuthStore } from '@/stores/auth.js'

// Build a Response whose body is a ReadableStream containing the given SSE text.
function mockResponse(sseBody) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('chatStreamService', () => {
  let fetchMock

  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    // Seed the auth store so accessToken is non-null
    const auth = useAuthStore()
    auth.session = { access_token: 'tok-123', user: { id: 'u1' } }
  })

  afterEach(() => vi.restoreAllMocks())

  it('POSTs to the chat-stream URL with bearer token and JSON body', async () => {
    const sseBody = 'event: done\ndata: {}\n\n'
    fetchMock.mockResolvedValueOnce(mockResponse(sseBody))

    const events = []
    await streamChat({ sessionId: 's1', message: 'hi', onEvent: (e) => events.push(e) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/chat/stream')
    expect(init.method).toBe('POST')
    expect(init.headers['authorization']).toBe('Bearer tok-123')
    expect(JSON.parse(init.body)).toEqual({ session_id: 's1', message: 'hi' })
  })

  it('invokes onEvent for each parsed SSE event', async () => {
    const sseBody =
      'event: assistant_delta\ndata: {"delta":"hello"}\n\nevent: done\ndata: {}\n\n'
    fetchMock.mockResolvedValueOnce(mockResponse(sseBody))

    const events = []
    await streamChat({ sessionId: 's1', message: 'hi', onEvent: (e) => events.push(e) })

    expect(events).toEqual([
      { event: 'assistant_delta', data: { delta: 'hello' } },
      { event: 'done', data: {} },
    ])
  })

  it('passes signal through to fetch and aborts cleanly', async () => {
    const ctrl = new AbortController()
    const sseBody = 'event: done\ndata: {}\n\n'
    fetchMock.mockResolvedValueOnce(mockResponse(sseBody))

    await streamChat({
      sessionId: 's1',
      message: 'hi',
      onEvent: () => {},
      signal: ctrl.signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1]
    expect(init.signal).toBe(ctrl.signal)
  })

  it('throws ApiError on non-2xx with parsed body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'bad' }), { status: 400 }),
    )

    await expect(
      streamChat({ sessionId: 's1', message: 'hi', onEvent: () => {} }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

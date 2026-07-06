import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionStore } from '@/stores/session.js'
import * as sessionsApi from '@/services/sessionsApi.js'
import * as streamSvc from '@/services/chatStreamService.js'

vi.mock('@/services/sessionsApi.js')
vi.mock('@/services/chatStreamService.js')
vi.mock('@/services/chatApi.js', () => ({ postChat: vi.fn() }))
vi.mock('@/services/costBus.js', () => ({ reportCostWarning: vi.fn() }))

function batchEvent() {
  return {
    gap: 'atp',
    total: 2,
    items: [
      { question: 'Q1', options: ['a', 'b'] },
      { question: 'Q2', options: ['a', 'b'] },
    ],
  }
}

describe('multi-check store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('answer advances currentIndex but keeps viewIndex (verdict visible)', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    expect(s.pendingCheck.viewIndex).toBe(0)
    sessionsApi.answerCheck.mockResolvedValue({
      correct: true, explanation: 'a.', correct_index: 0,
      current_index: 1, total: 2, has_next: true, done: false,
    })
    await s.answerCheck(0)
    expect(s.pendingCheck.currentIndex).toBe(1)
    expect(s.pendingCheck.viewIndex).toBe(0)
    expect(s.pendingCheck.items[0].status).toBe('answered')
    expect(s.pendingCheck.items[0].correct).toBe(true)
  })

  it('nextCheck moves view to the next unanswered item', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    sessionsApi.answerCheck.mockResolvedValue({
      correct: true, explanation: 'a.', correct_index: 0,
      current_index: 1, total: 2, has_next: true, done: false,
    })
    await s.answerCheck(0)
    s.nextCheck()
    expect(s.pendingCheck.viewIndex).toBe(1)
  })

  it('answering the last item marks done; completeCheck fires once', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    sessionsApi.answerCheck
      .mockResolvedValueOnce({ correct: true, explanation: 'a.', correct_index: 0, current_index: 1, total: 2, has_next: true, done: false })
      .mockResolvedValueOnce({ correct: true, explanation: 'a.', correct_index: 0, current_index: 2, total: 2, has_next: false, done: true })
    streamSvc.streamCheckComplete.mockResolvedValue(undefined)
    await s.answerCheck(0)
    s.nextCheck()
    await s.answerCheck(0)
    expect(s.pendingCheck.items[1].status).toBe('answered')
    await s.completeCheck()
    await s.completeCheck()
    expect(streamSvc.streamCheckComplete).toHaveBeenCalledTimes(1)
    expect(s.pendingCheck).toBeNull()
  })

  it('per-item skip that resolves the batch fires completeCheck', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion({ gap: 'atp', total: 1, items: [{ question: 'Q1', options: ['a', 'b'] }] })
    sessionsApi.skipCheck.mockResolvedValue({ current_index: 1, total: 1, has_next: false, done: true })
    streamSvc.streamCheckComplete.mockResolvedValue(undefined)
    await s.skipCheck()
    expect(streamSvc.streamCheckComplete).toHaveBeenCalledTimes(1)
    expect(s.pendingCheck).toBeNull()
  })

  it('loadSession rebuilds batch at current_index with prior verdicts', async () => {
    const s = useSessionStore()
    sessionsApi.getSession.mockResolvedValue({
      id: 'sid', messages: [],
      pending_check: {
        gap: 'atp', current_index: 1, total: 2,
        items: [
          { question: 'Q1', options: ['a', 'b'], status: 'answered',
            selected_index: 0, correct_index: 0, correct: true, explanation: 'a.' },
          { question: 'Q2', options: ['a', 'b'], status: 'pending',
            selected_index: null, correct_index: null, correct: null, explanation: null },
        ],
      },
    })
    await s.loadSession('sid')
    expect(s.pendingCheck.currentIndex).toBe(1)
    expect(s.pendingCheck.viewIndex).toBe(1)
    expect(s.pendingCheck.items[0].correct).toBe(true)
  })

  it('followup_skipped clears stream state and sets a quiet notice', async () => {
    const s = useSessionStore()
    s.currentSessionId = 'sid'
    s.handleCheckQuestion(batchEvent())
    streamSvc.streamCheckComplete.mockImplementation(async ({ onEvent }) => {
      onEvent({ event: 'followup_skipped', data: { reason: 'daily_cap' } })
    })
    await s.completeCheck()
    expect(s.followupNotice).toMatch(/daily message limit/i)
    expect(s.streamingMessage).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.error).toBeNull()
  })

  it('loadSession maps check_batch onto messages (camelCase)', async () => {
    const store = useSessionStore()
    sessionsApi.getSession.mockResolvedValue({
      id: 's1', messages: [
        {
          id: 1, role: 'assistant', content: '', created_at: '2026-06-07T00:00:00Z',
          citations: [], tool_calls: [],
          check_batch: {
            gap: 'atp', current_index: 1, total: 1,
            items: [{ question: 'Q?', options: ['a', 'b'], status: 'answered',
                      selected_index: 0, correct_index: 0, correct: true,
                      explanation: 'a.' }],
          },
        },
      ],
      pending_check: null,
    })
    await store.loadSession('s1')
    const cb = store.messages[0].check_batch
    expect(cb.gap).toBe('atp')
    expect(cb.items[0].selectedIndex).toBe(0)
    expect(cb.items[0].correctIndex).toBe(0)
    expect(cb.items[0].correct).toBe(true)
  })
})

import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/sessionsApi.js', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  endSession: vi.fn(),
  reopenSession: vi.fn(),
  renameSession: vi.fn(),
  setPinned: vi.fn(),
  skipCheck: vi.fn(),
  answerCheck: vi.fn(),
}))
vi.mock('@/services/chatApi.js', () => ({ postChat: vi.fn() }))
vi.mock('@/services/chatStreamService.js', () => ({ streamChat: vi.fn() }))
vi.mock('@/services/costBus.js', () => ({ reportCostWarning: vi.fn() }))

import { useSessionStore } from '@/stores/session.js'
import * as sessionsApi from '@/services/sessionsApi.js'

describe('check-question flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets pendingCheck on check_question and locks', () => {
    const store = useSessionStore()
    store.handleCheckQuestion({ gap: 'g', question: 'Inputs?', options: ['A', 'B'] })
    expect(store.pendingCheck).toEqual({ gap: 'g', question: 'Inputs?', options: ['A', 'B'], verdict: null })
    expect(store.checkLocked).toBe(true)
  })

  it('skipCheck calls API and clears pendingCheck', async () => {
    const store = useSessionStore()
    store.currentSessionId = 's1'
    store.handleCheckQuestion({ gap: 'g', question: 'q?' })
    sessionsApi.skipCheck.mockResolvedValueOnce({ ok: true })
    await store.skipCheck()
    expect(sessionsApi.skipCheck).toHaveBeenCalledWith('s1')
    expect(store.pendingCheck).toBe(null)
  })

  it('answerCheck sets verdict, selectedIndex, explanation, correctIndex and unlocks', async () => {
    const store = useSessionStore()
    store.currentSessionId = 's1'
    store.pendingCheck = { gap: 'g', question: 'q', options: ['a', 'b'], verdict: null }
    vi.spyOn(sessionsApi, 'answerCheck').mockResolvedValue({
      correct: true, explanation: 'x', correct_index: 1,
    })
    await store.answerCheck(1)
    expect(sessionsApi.answerCheck).toHaveBeenCalledWith('s1', 1)
    expect(store.pendingCheck.verdict).toBe(true)
    expect(store.pendingCheck.selectedIndex).toBe(1)
    expect(store.pendingCheck.explanation).toBe('x')
    expect(store.pendingCheck.correctIndex).toBe(1)
    expect(store.checkLocked).toBe(false)
  })
})

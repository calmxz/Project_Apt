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

  it('sets pendingCheck on check_question and locks; clears verdict on check_result', () => {
    const store = useSessionStore()
    store.handleCheckQuestion({ gap: 'g', question: 'Inputs?' })
    expect(store.pendingCheck).toEqual({ gap: 'g', question: 'Inputs?', verdict: null })
    expect(store.checkLocked).toBe(true)

    store.handleCheckResult({ gap: 'g', correct: true })
    expect(store.pendingCheck.verdict).toBe(true)
    expect(store.checkLocked).toBe(false) // answered -> unlocked
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
})

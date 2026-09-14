import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import * as sessionsApi from '@/services/sessionsApi.js'
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

  const AGGREGATE_ARRAY_KEYS = [
    'combined_mastered_concepts',
    'combined_confirmed_gaps',
    'recent_topics',
    'concept_accuracy',
    'weekly_mastery',
  ]

  it('getAggregateProfile defaults all contract array keys to [] when the API resolves {}', async () => {
    fetchMock.mockReturnValueOnce(ok({}))
    const result = await getAggregateProfile()
    for (const key of AGGREGATE_ARRAY_KEYS) {
      expect(result[key]).toEqual([])
    }
  })

  it('getAggregateProfile defaults missing array keys when the API resolves a partial object', async () => {
    fetchMock.mockReturnValueOnce(
      ok({ total_sessions: 3, combined_mastered_concepts: [{ concept: 'x', count: 1 }] }),
    )
    const result = await getAggregateProfile()
    expect(result.total_sessions).toBe(3)
    expect(result.combined_mastered_concepts).toEqual([{ concept: 'x', count: 1 }])
    expect(result.combined_confirmed_gaps).toEqual([])
    expect(result.recent_topics).toEqual([])
    expect(result.concept_accuracy).toEqual([])
    expect(result.weekly_mastery).toEqual([])
  })

  it('getAggregateProfile defaults all contract array keys to [] when the API resolves null', async () => {
    fetchMock.mockReturnValueOnce(ok(null))
    const result = await getAggregateProfile()
    for (const key of AGGREGATE_ARRAY_KEYS) {
      expect(result[key]).toEqual([])
    }
  })

  it('getAggregateProfile passes a full valid payload through unchanged', async () => {
    const payload = {
      total_sessions: 2,
      active_sessions: 1,
      ended_sessions: 1,
      total_learning_events: 5,
      combined_mastered_concepts: [{ concept: 'a', count: 1 }],
      combined_confirmed_gaps: [{ concept: 'b', count: 1 }],
      knowledge_level_distribution: { beginner: 1, intermediate: 0, advanced: 0, unknown: 0 },
      recent_topics: [{ id: 's1', topic: 't', created_at: '2026-01-01T00:00:00Z' }],
      concept_accuracy: [],
      weekly_mastery: [],
    }
    fetchMock.mockReturnValueOnce(ok(payload))
    const result = await getAggregateProfile()
    expect(result).toEqual(payload)
  })
})

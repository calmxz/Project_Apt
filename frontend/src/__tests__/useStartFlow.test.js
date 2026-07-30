import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useStartFlow } from '@/composables/useStartFlow.js'

function makeStore(overrides = {}) {
  return {
    lookupTopic: vi.fn().mockResolvedValue({ active_match: null, ended_match: null }),
    createSession: vi.fn().mockResolvedValue({ id: 'new1' }),
    continueTopic: vi.fn().mockResolvedValue({ id: 'res1' }),
    ...overrides,
  }
}

const router = { push: vi.fn() }

beforeEach(() => router.push.mockClear())

describe('useStartFlow', () => {
  it('no match: begin goes to level stage', async () => {
    const flow = useStartFlow({ store: makeStore(), router })
    await flow.begin('new topic')
    expect(flow.stage.value).toBe('level')
  })

  it('lookup failure (null) falls back to level stage', async () => {
    const store = makeStore({ lookupTopic: vi.fn().mockResolvedValue(null) })
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    expect(flow.stage.value).toBe('level')
  })

  it('active match: intercept stage, openExisting navigates', async () => {
    const store = makeStore({
      lookupTopic: vi.fn().mockResolvedValue({
        active_match: { session_id: 'a1', title: 'CSS' },
        ended_match: null,
      }),
    })
    const flow = useStartFlow({ store, router })
    await flow.begin('css')
    expect(flow.stage.value).toBe('intercept')
    expect(flow.interceptKind.value).toBe('active')
    flow.openExisting()
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a1' } })
  })

  it('ended match: continuePrior resumes and navigates', async () => {
    const store = makeStore({
      lookupTopic: vi.fn().mockResolvedValue({
        active_match: null,
        ended_match: { session_id: 'e1', title: 'CSS', gap_count: 2 },
      }),
    })
    const flow = useStartFlow({ store, router })
    await flow.begin('css')
    expect(flow.interceptKind.value).toBe('ended')
    await flow.continuePrior()
    expect(store.continueTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', topic: 'CSS' }),
    )
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'res1' } })
  })

  it('startFresh moves intercept -> level', async () => {
    const store = makeStore({
      lookupTopic: vi.fn().mockResolvedValue({
        active_match: null,
        ended_match: { session_id: 'e1', title: 'CSS' },
      }),
    })
    const flow = useStartFlow({ store, router })
    await flow.begin('css')
    flow.startFresh()
    expect(flow.stage.value).toBe('level')
  })

  it('pickLevel creates with declaredLevel and navigates', async () => {
    const store = makeStore()
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.pickLevel('advanced')
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 't', seedMode: 'fresh', declaredLevel: 'advanced' }),
    )
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new1' } })
  })

  it('pickQuiz creates plain and navigates with quiz query', async () => {
    const store = makeStore()
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.pickQuiz()
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ declaredLevel: null }),
    )
    expect(router.push).toHaveBeenCalledWith({
      name: 'session',
      params: { id: 'new1' },
      query: { quiz: '1' },
    })
  })

  it('skipLevel creates plain and navigates without query', async () => {
    const store = makeStore()
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.skipLevel()
    expect(router.push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new1' } })
  })

  it('409 duplicate on create shows active intercept instead of navigating', async () => {
    const err = Object.assign(new Error('dup'), {
      status: 409,
      body: { detail: { code: 'duplicate_topic', session_id: 'a9' } },
    })
    const store = makeStore({ createSession: vi.fn().mockRejectedValue(err) })
    const flow = useStartFlow({ store, router })
    await flow.begin('t')
    await flow.skipLevel()
    expect(router.push).not.toHaveBeenCalled()
    expect(flow.stage.value).toBe('intercept')
    expect(flow.interceptKind.value).toBe('active')
    expect(flow.interceptMatch.value.session_id).toBe('a9')
  })

  it('awaits beforeNavigate hook between create and push', async () => {
    const order = []
    const store = makeStore({
      createSession: vi.fn().mockImplementation(async () => {
        order.push('create')
        return { id: 'n1' }
      }),
    })
    const beforeNavigate = vi.fn().mockImplementation(async () => order.push('hook'))
    const flow = useStartFlow({ store, router, beforeNavigate })
    await flow.begin('t')
    await flow.skipLevel()
    expect(order).toEqual(['create', 'hook'])
    expect(router.push).toHaveBeenCalled()
  })

  it('cancel returns to idle', async () => {
    const flow = useStartFlow({ store: makeStore(), router })
    await flow.begin('t')
    flow.cancel()
    expect(flow.stage.value).toBe('idle')
  })
})

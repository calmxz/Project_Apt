import { describe, it, expect } from 'vitest'
import { friendlyError, StreamAbortedError } from '../lib/errors'

describe('friendlyError', () => {
  const coded = (status, code) => ({ status, body: { detail: { code } } })

  it('distinguishes nginx throttle 429 from daily-cap 429', () => {
    expect(friendlyError(coded(429, 'daily_cap_reached'))).toMatch(/daily limit/i)
    expect(friendlyError({ status: 429, body: '<html>429</html>' })).toMatch(/wait a moment/i)
  })

  it('maps daily_cost_cap_reached to the daily-limit copy', () => {
    expect(friendlyError(coded(429, 'daily_cost_cap_reached'))).toMatch(/daily limit/i)
  })

  it('maps global_cost_cap_reached to service-budget copy, not per-user copy', () => {
    const msg = friendlyError(coded(429, 'global_cost_cap_reached'))
    expect(msg).toMatch(/service has reached its daily budget/i)
    expect(msg).not.toMatch(/you've hit/i)
  })

  it('maps too_many_requests to the wait-and-retry copy', () => {
    expect(friendlyError(coded(429, 'too_many_requests'))).toMatch(/wait a moment/i)
  })

  it('maps chunk_limit_exceeded (413) to the split-the-document copy', () => {
    expect(friendlyError(coded(413, 'chunk_limit_exceeded'))).toMatch(/too large to ingest/i)
  })

  it('falls back to the status copy for an unknown code', () => {
    expect(friendlyError(coded(429, 'something_new'))).toMatch(/daily limit/i)
    expect(friendlyError(coded(400, 'something_new'))).toMatch(/rejected/i)
  })
})

describe('StreamAbortedError', () => {
  it('carries reason and cause', () => {
    const cause = Object.assign(new Error('API 401'), { status: 401 })
    const e = new StreamAbortedError('auth_expired', cause)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('StreamAbortedError')
    expect(e.reason).toBe('auth_expired')
    expect(e.cause).toBe(cause)
  })
})

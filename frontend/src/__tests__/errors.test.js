import { describe, it, expect } from 'vitest'
import { friendlyError, StreamAbortedError } from '../lib/errors'

describe('errors', () => {
  it('distinguishes nginx throttle 429 from daily-cap 429', () => {
    const capErr = { status: 429, body: { detail: { code: 'daily_cap_reached' } } }
    const throttleErr = { status: 429, body: '<html>429</html>' }
    expect(friendlyError(capErr)).toMatch(/daily limit/i)
    expect(friendlyError(throttleErr)).toMatch(/wait a moment/i)
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

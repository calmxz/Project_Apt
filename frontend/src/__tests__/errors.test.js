import { describe, it, expect } from 'vitest'
import { friendlyError } from '../lib/errors'

describe('errors', () => {
  it('distinguishes nginx throttle 429 from daily-cap 429', () => {
    const capErr = { status: 429, body: { detail: { code: 'daily_cap_reached' } } }
    const throttleErr = { status: 429, body: '<html>429</html>' }
    expect(friendlyError(capErr)).toMatch(/daily limit/i)
    expect(friendlyError(throttleErr)).toMatch(/wait a moment/i)
  })
})

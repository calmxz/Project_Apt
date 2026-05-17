import { describe, it, expect, vi, beforeEach } from 'vitest'
import { errorBus, reportApiError } from '../services/errorBus.js'

describe('errorBus', () => {
  let listener
  beforeEach(() => {
    listener = vi.fn()
    errorBus.addEventListener('api-error', listener)
  })

  it('dispatches api-error with the error payload', () => {
    const err = { status: 500, body: { detail: 'boom' }, message: 'oops' }
    reportApiError(err)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail).toBe(err)
    errorBus.removeEventListener('api-error', listener)
  })

  it('does not fire listeners for unrelated event names', () => {
    errorBus.dispatchEvent(new CustomEvent('other-event'))
    expect(listener).not.toHaveBeenCalled()
    errorBus.removeEventListener('api-error', listener)
  })

  it('removeEventListener stops further calls', () => {
    errorBus.removeEventListener('api-error', listener)
    reportApiError({ status: 500 })
    expect(listener).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { routeProgress, start, finish, fail } from '@/services/routeProgress.js'

describe('routeProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    finish()
    vi.runAllTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('does not show before 150ms', () => {
    start()
    vi.advanceTimersByTime(149)
    expect(routeProgress.visible).toBe(false)
  })

  it('shows after 150ms and trickles', () => {
    start()
    vi.advanceTimersByTime(150)
    expect(routeProgress.visible).toBe(true)
    expect(routeProgress.progress).toBeGreaterThan(0)
  })

  it('finish before threshold never shows the bar', () => {
    start()
    vi.advanceTimersByTime(100)
    finish()
    vi.runAllTimers()
    expect(routeProgress.visible).toBe(false)
  })

  it('finish while visible completes to 100 then hides', () => {
    start()
    vi.advanceTimersByTime(150)
    finish()
    expect(routeProgress.progress).toBe(1)
    vi.runAllTimers()
    expect(routeProgress.visible).toBe(false)
    expect(routeProgress.progress).toBe(0)
  })

  it('overlapping start resets cleanly', () => {
    start()
    vi.advanceTimersByTime(150)
    start()
    expect(routeProgress.visible).toBe(false)
    vi.advanceTimersByTime(150)
    expect(routeProgress.visible).toBe(true)
  })

  it('fail is the same teardown as finish', () => {
    start()
    vi.advanceTimersByTime(150)
    fail()
    vi.runAllTimers()
    expect(routeProgress.visible).toBe(false)
  })
})

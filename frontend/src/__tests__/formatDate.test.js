import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDate, formatShortDateTime, formatRelative } from '@/utils/formatDate.js'

describe('formatDate utils', () => {
  afterEach(() => vi.useRealTimers())

  it('formatDate returns empty string for empty input', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate(undefined)).toBe('')
  })

  it('formatDate returns a non-empty string for a real ISO', () => {
    expect(formatDate('2026-01-15T10:00:00Z')).not.toBe('')
  })

  it('formatShortDateTime handles empty input', () => {
    expect(formatShortDateTime(null)).toBe('')
    expect(formatShortDateTime('2026-01-15T10:00:00Z')).not.toBe('')
  })

  it('formatRelative empty input', () => {
    expect(formatRelative('')).toBe('')
  })

  it('formatRelative returns minute-level string for recent past', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const out = formatRelative('2026-01-15T11:55:00Z')
    expect(out).toMatch(/minute|min/i)
  })

  it('formatRelative returns hour-level for past hour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const out = formatRelative('2026-01-15T08:00:00Z')
    expect(out).toMatch(/hour|hr/i)
  })

  it('formatRelative returns day-level for yesterday', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const out = formatRelative('2026-01-14T12:00:00Z')
    expect(out).toMatch(/day|yesterday/i)
  })

  it('formatRelative returns year-level for >1 year ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    const out = formatRelative('2020-01-15T12:00:00Z')
    expect(out).toMatch(/year/i)
  })
})

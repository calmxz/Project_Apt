import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  stripAutoPrefix,
  cardMeta,
  cardStory,
  cardChips,
  railMeta,
} from '@/utils/sessionCard.js'

const active = (over = {}) => ({
  id: 's', topic: 'Bio', created_at: '2026-06-01T00:00:00Z',
  ended_at: null, message_count: 0, last_activity_at: null,
  last_message_preview: null, progress: { focus_target_gap: null, mastered_count: 0 },
  ...over,
})

afterEach(() => vi.useRealTimers())

describe('stripAutoPrefix', () => {
  it('removes a leading [auto] marker', () => {
    expect(stripAutoPrefix('[auto] Recap of cells')).toBe('Recap of cells')
  })
  it('passes through plain text and null', () => {
    expect(stripAutoPrefix('hello')).toBe('hello')
    expect(stripAutoPrefix(null)).toBe('')
  })
})

describe('cardMeta', () => {
  it('pluralizes messages and includes last-active', () => {
    const s = active({ message_count: 3, last_activity_at: '2026-06-01T00:00:00Z' })
    expect(cardMeta(s)).toMatch(/^3 messages · last active /)
  })
  it('singular message; falls back to created_at when no activity', () => {
    const s = active({ message_count: 1, last_activity_at: null })
    expect(cardMeta(s)).toMatch(/^1 message · last active /)
  })
  it('omits the activity clause when no timestamp at all', () => {
    const s = active({ message_count: 0, created_at: null, last_activity_at: null })
    expect(cardMeta(s)).toBe('0 messages')
  })
})

describe('cardStory', () => {
  it('active: returns the trimmed preview', () => {
    const s = active({ last_message_preview: '  What is ATP?  ' })
    expect(cardStory(s)).toBe('What is ATP?')
  })

  it('active: empty string when no preview — focus and mastery do NOT leak in', () => {
    const s = active({ progress: { focus_target_gap: 'ATP yield', mastered_count: 3 } })
    expect(cardStory(s)).toBe('')
  })

  it('ended: summary with [auto] stripped; Completed fallback', () => {
    const ended = active({
      ended_at: '2026-06-02T00:00:00Z',
      last_session_summary: '[auto] Covered the Krebs cycle',
    })
    expect(cardStory(ended)).toBe('Covered the Krebs cycle')
    const bare = active({ ended_at: '2026-06-02T00:00:00Z', last_session_summary: null })
    expect(cardStory(bare)).toBe('Completed')
  })
})

describe('cardChips', () => {
  it('returns focus then mastered when both present', () => {
    const s = active({ progress: { focus_target_gap: 'ATP yield', mastered_count: 2 } })
    expect(cardChips(s)).toEqual([
      { type: 'focus', label: 'ATP yield' },
      { type: 'mastered', label: '2 mastered', count: 2 },
    ])
  })

  it('omits the mastered chip at zero and the focus chip when null', () => {
    expect(cardChips(active())).toEqual([])
    expect(
      cardChips(active({ progress: { focus_target_gap: null, mastered_count: 1 } })),
    ).toEqual([{ type: 'mastered', label: '1 mastered', count: 1 }])
  })

  it('handles null progress safely', () => {
    expect(cardChips(active({ progress: null }))).toEqual([])
  })
})

describe('railMeta', () => {
  it('compact count and short relative time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T02:00:00Z'))
    const s = active({ message_count: 12, last_activity_at: '2026-06-01T00:00:00Z' })
    expect(railMeta(s)).toBe('12 msgs · 2h ago')
  })

  it('singular msg; falls back to created_at', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:05:00Z'))
    const s = active({ message_count: 1 })
    expect(railMeta(s)).toBe('1 msg · 5m ago')
  })

  it('shows "now" when the timestamp is under a minute old', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:30Z'))
    const s = active({ message_count: 2 })
    expect(railMeta(s)).toBe('2 msgs · now')
  })

  it('omits the time clause when no timestamps at all', () => {
    const s = active({ message_count: 0, created_at: null, last_activity_at: null })
    expect(railMeta(s)).toBe('0 msgs')
  })
})

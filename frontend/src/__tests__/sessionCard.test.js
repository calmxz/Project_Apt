import { describe, it, expect } from 'vitest'
import { stripAutoPrefix, cardDescription, cardMeta } from '@/utils/sessionCard.js'

const active = (over = {}) => ({
  id: 's', topic: 'Bio', created_at: '2026-06-01T00:00:00Z',
  ended_at: null, message_count: 0, last_activity_at: null,
  last_message_preview: null, progress: { focus_target_gap: null, mastered_count: 0 },
  ...over,
})

describe('stripAutoPrefix', () => {
  it('removes a leading [auto] marker', () => {
    expect(stripAutoPrefix('[auto] Recap of cells')).toBe('Recap of cells')
  })
  it('passes through plain text and null', () => {
    expect(stripAutoPrefix('hello')).toBe('hello')
    expect(stripAutoPrefix(null)).toBe('')
  })
})

describe('cardDescription — active precedence', () => {
  it('tier 1: focus_target_gap wins', () => {
    const s = active({ progress: { focus_target_gap: 'ATP yield', mastered_count: 2 },
                       last_message_preview: 'ignored' })
    expect(cardDescription(s)).toBe('Focus: ATP yield')
  })
  it('tier 2: preview when no focus', () => {
    const s = active({ last_message_preview: 'glycolysis nets 2 ATP',
                       progress: { focus_target_gap: null, mastered_count: 5 } })
    expect(cardDescription(s)).toBe('glycolysis nets 2 ATP')
  })
  it('tier 2: whitespace-only preview is skipped', () => {
    const s = active({ last_message_preview: '   ',
                       progress: { focus_target_gap: null, mastered_count: 3 } })
    expect(cardDescription(s)).toBe('3 concepts mastered')
  })
  it('tier 3: mastered_count, singular vs plural', () => {
    expect(cardDescription(active({ progress: { focus_target_gap: null, mastered_count: 1 } })))
      .toBe('1 concept mastered')
    expect(cardDescription(active({ progress: { focus_target_gap: null, mastered_count: 4 } })))
      .toBe('4 concepts mastered')
  })
  it('tier 4: empty string when nothing to show', () => {
    expect(cardDescription(active())).toBe('')
  })
  it('handles null progress safely', () => {
    expect(cardDescription(active({ progress: null }))).toBe('')
  })
})

describe('cardDescription — ended', () => {
  it('shows summary with [auto] stripped', () => {
    const s = active({ ended_at: '2026-06-02T00:00:00Z',
                       last_session_summary: '[auto] Covered the Krebs cycle' })
    expect(cardDescription(s)).toBe('Covered the Krebs cycle')
  })
  it('falls back to Completed', () => {
    const s = active({ ended_at: '2026-06-02T00:00:00Z', last_session_summary: null })
    expect(cardDescription(s)).toBe('Completed')
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

// frontend/src/__tests__/useSessionGroups.test.js
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSessionGroups } from '@/composables/useSessionGroups.js'

// Fixed reference clock: 2026-05-30T12:00:00Z
const NOW = new Date('2026-05-30T12:00:00Z').getTime()
const iso = (d) => new Date(d).toISOString()

function sess(over = {}) {
  return {
    id: over.id || 'x',
    topic: over.topic ?? 'Topic',
    created_at: over.created_at ?? iso('2026-05-30T09:00:00Z'),
    last_activity_at: over.last_activity_at ?? null,
    ended_at: over.ended_at ?? null,
    pinned: over.pinned ?? false,
  }
}

describe('useSessionGroups', () => {
  it('buckets active sessions by created_at: today / week / older', () => {
    const sessions = ref([
      sess({ id: 'today', created_at: iso('2026-05-30T08:00:00Z') }),
      sess({ id: 'week', created_at: iso('2026-05-27T08:00:00Z') }),
      sess({ id: 'older', created_at: iso('2026-05-01T08:00:00Z') }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['today'])
    expect(byKey.week).toEqual(['week'])
    expect(byKey.older).toEqual(['older'])
  })

  it('omits empty buckets', () => {
    const sessions = ref([sess({ id: 'today', created_at: iso('2026-05-30T08:00:00Z') })])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    expect(activeGroups.value.map((g) => g.key)).toEqual(['today'])
  })

  it('floats pinned active sessions into pinnedActive, out of date groups', () => {
    const sessions = ref([
      sess({ id: 'p', pinned: true, created_at: iso('2026-05-01T08:00:00Z') }),
      sess({ id: 'today', created_at: iso('2026-05-30T08:00:00Z') }),
    ])
    const { pinnedActive, activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    expect(pinnedActive.value.map((r) => r.id)).toEqual(['p'])
    const allGrouped = activeGroups.value.flatMap((g) => g.rows.map((r) => r.id))
    expect(allGrouped).not.toContain('p')
  })

  it('keeps ended sessions separate and never pins them', () => {
    const sessions = ref([
      sess({ id: 'e', ended_at: iso('2026-05-29T08:00:00Z'), pinned: true }),
      sess({ id: 'a', created_at: iso('2026-05-30T08:00:00Z') }),
    ])
    const { endedRows, pinnedActive } = useSessionGroups(sessions, ref(''), ref(NOW))
    expect(endedRows.value.map((r) => r.id)).toEqual(['e'])
    expect(pinnedActive.value).toEqual([])
  })

  it('search produces a flat case-insensitive filtered list and suppresses grouping', () => {
    const sessions = ref([
      sess({ id: 'a', topic: 'Photosynthesis' }),
      sess({ id: 'b', topic: 'Big-O notation', ended_at: iso('2026-05-29T08:00:00Z') }),
    ])
    const search = ref('big')
    const { searching, filteredFlat, matchCount, activeGroups, pinnedActive } =
      useSessionGroups(sessions, search, ref(NOW))
    expect(searching.value).toBe(true)
    expect(filteredFlat.value.map((r) => r.id)).toEqual(['b'])
    expect(matchCount.value).toBe(1)
    expect(activeGroups.value).toEqual([])
    expect(pinnedActive.value).toEqual([])
  })

  it('untitled sessions match the literal "untitled"', () => {
    const sessions = ref([sess({ id: 'u', topic: '' })])
    const { filteredFlat } = useSessionGroups(sessions, ref('untitled'), ref(NOW))
    expect(filteredFlat.value.map((r) => r.id)).toEqual(['u'])
  })

  it('today boundary: a session at exactly the UTC day start is "today"', () => {
    const todayStart = Date.UTC(2026, 4, 30) // 2026-05-30T00:00:00Z
    const sessions = ref([
      sess({ id: 't', created_at: iso(todayStart) }),
      sess({ id: 'yest', created_at: iso(todayStart - 1) }), // one ms earlier => week
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['t'])
    expect(byKey.week).toEqual(['yest'])
  })

  it('week boundary: exactly 6 UTC days before today start is "week", one ms earlier is "older"', () => {
    const weekStart = Date.UTC(2026, 4, 24) // 2026-05-24T00:00:00Z
    const sessions = ref([
      sess({ id: 'w', created_at: iso(weekStart) }),
      sess({ id: 'o', created_at: iso(weekStart - 1) }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.week).toEqual(['w'])
    expect(byKey.older).toEqual(['o'])
  })

  it('buckets by last_activity_at, not created_at: an old session touched today is "today"', () => {
    const sessions = ref([
      sess({
        id: 'touched',
        created_at: iso('2026-05-01T08:00:00Z'), // old
        last_activity_at: iso('2026-05-30T08:00:00Z'), // today
      }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['touched'])
    expect(byKey.older).toBeUndefined()
  })

  it('falls back to created_at when last_activity_at is null', () => {
    const sessions = ref([
      sess({ id: 'noact', created_at: iso('2026-05-30T08:00:00Z'), last_activity_at: null }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(activeGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['noact'])
  })

  it('sorts rows within a bucket most-recently-active first', () => {
    const sessions = ref([
      sess({ id: 'older', last_activity_at: iso('2026-05-30T06:00:00Z') }),
      sess({ id: 'newer', last_activity_at: iso('2026-05-30T11:00:00Z') }),
    ])
    const { activeGroups } = useSessionGroups(sessions, ref(''), ref(NOW))
    const today = activeGroups.value.find((g) => g.key === 'today')
    expect(today.rows.map((r) => r.id)).toEqual(['newer', 'older'])
  })

  it('exposes endedGroups bucketed by last activity', () => {
    const sessions = ref([
      sess({
        id: 'e-today',
        ended_at: iso('2026-05-29T08:00:00Z'),
        last_activity_at: iso('2026-05-30T08:00:00Z'),
      }),
      sess({
        id: 'e-old',
        ended_at: iso('2026-05-02T08:00:00Z'),
        last_activity_at: iso('2026-05-01T08:00:00Z'),
      }),
    ])
    const { endedGroups, endedRows } = useSessionGroups(sessions, ref(''), ref(NOW))
    const byKey = Object.fromEntries(endedGroups.value.map((g) => [g.key, g.rows.map((r) => r.id)]))
    expect(byKey.today).toEqual(['e-today'])
    expect(byKey.older).toEqual(['e-old'])
    // flat endedRows retained for the count badge + collapsed rail, sorted by activity
    expect(endedRows.value.map((r) => r.id)).toEqual(['e-today', 'e-old'])
  })
})

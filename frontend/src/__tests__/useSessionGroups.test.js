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
})

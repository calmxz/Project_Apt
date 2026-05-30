// frontend/src/composables/useSessionGroups.js
import { computed, unref } from 'vue'

const DAY_MS = 86_400_000

function startOfUtcDay(ms) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function bucketKey(createdAtIso, nowMs) {
  const t = new Date(createdAtIso).getTime()
  const todayStart = startOfUtcDay(nowMs)
  if (t >= todayStart) return 'today'
  if (t >= todayStart - 6 * DAY_MS) return 'week'
  return 'older'
}

const GROUP_LABELS = { today: 'Today', week: 'This week', older: 'Older' }
const GROUP_ORDER = ['today', 'week', 'older']

function matchTopic(session, q) {
  const topic = (session.topic || 'untitled').toLowerCase()
  return topic.includes(q)
}

export function useSessionGroups(sessions, searchQuery, now) {
  const rows = computed(() => unref(sessions) || [])
  const query = computed(() => (unref(searchQuery) || '').trim().toLowerCase())
  const nowMs = computed(() => unref(now) ?? Date.now())

  const searching = computed(() => query.value.length > 0)

  const filteredFlat = computed(() =>
    searching.value ? rows.value.filter((s) => matchTopic(s, query.value)) : [],
  )
  const matchCount = computed(() => filteredFlat.value.length)

  const active = computed(() => rows.value.filter((s) => !s.ended_at))

  const pinnedActive = computed(() =>
    searching.value ? [] : active.value.filter((s) => s.pinned),
  )

  const activeGroups = computed(() => {
    if (searching.value) return []
    const unpinned = active.value.filter((s) => !s.pinned)
    const byKey = { today: [], week: [], older: [] }
    for (const s of unpinned) byKey[bucketKey(s.created_at, nowMs.value)].push(s)
    return GROUP_ORDER.filter((k) => byKey[k].length).map((k) => ({
      key: k,
      label: GROUP_LABELS[k],
      rows: byKey[k],
    }))
  })

  const endedRows = computed(() =>
    searching.value ? [] : rows.value.filter((s) => Boolean(s.ended_at)),
  )

  return { searching, filteredFlat, matchCount, pinnedActive, activeGroups, endedRows }
}

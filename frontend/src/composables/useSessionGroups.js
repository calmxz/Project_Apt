// frontend/src/composables/useSessionGroups.js
import { computed, unref } from 'vue'

const DAY_MS = 86_400_000

// Dates bucket by UTC calendar day so grouping is consistent across timezones.
function startOfUtcDay(ms) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Activity timestamp drives bucketing AND sorting. Falls back to created_at
// when a session has no messages (last_activity_at is null). Returns ms, 0 if neither.
function activityMs(session) {
  const ts = session.last_activity_at || session.created_at
  return ts ? new Date(ts).getTime() : 0
}

function bucketKey(activityTs, nowMs) {
  const todayStart = startOfUtcDay(nowMs)
  if (activityTs >= todayStart) return 'today'
  if (activityTs >= todayStart - 6 * DAY_MS) return 'week'
  return 'older'
}

const GROUP_LABELS = { today: 'Today', week: 'This week', older: 'Older' }
const GROUP_ORDER = ['today', 'week', 'older']

function matchTopic(session, q) {
  const topic = (session.topic || 'untitled').toLowerCase()
  return topic.includes(q)
}

// Most-recently-active first.
function byActivityDesc(a, b) {
  return activityMs(b) - activityMs(a)
}

function groupByActivity(list, nowMs) {
  const byKey = { today: [], week: [], older: [] }
  for (const s of list) byKey[bucketKey(activityMs(s), nowMs)].push(s)
  for (const k of GROUP_ORDER) byKey[k].sort(byActivityDesc)
  return GROUP_ORDER.filter((k) => byKey[k].length).map((k) => ({
    key: k,
    label: GROUP_LABELS[k],
    rows: byKey[k],
  }))
}

export function useSessionGroups(sessions, searchQuery, now) {
  const rows = computed(() => unref(sessions) || [])
  const query = computed(() => (unref(searchQuery) || '').trim().toLowerCase())
  // When `now` is null at runtime, Date.now() is captured at setup time; buckets
  // refresh on next mount. No ticker needed at this data scale.
  const nowMs = computed(() => unref(now) ?? Date.now())

  const searching = computed(() => query.value.length > 0)

  // Search shows a flat, case-insensitive match list across all sessions, unsorted —
  // matches prior production behavior; spec scopes search to a "flat list", not sorted.
  const filteredFlat = computed(() =>
    searching.value ? rows.value.filter((s) => matchTopic(s, query.value)) : [],
  )
  const matchCount = computed(() => filteredFlat.value.length)

  const active = computed(() => rows.value.filter((s) => !s.ended_at))

  const pinnedActive = computed(() =>
    searching.value ? [] : active.value.filter((s) => s.pinned).slice().sort(byActivityDesc),
  )

  const activeGroups = computed(() => {
    if (searching.value) return []
    const unpinned = active.value.filter((s) => !s.pinned)
    return groupByActivity(unpinned, nowMs.value)
  })

  const endedAll = computed(() => rows.value.filter((s) => Boolean(s.ended_at)))

  const endedGroups = computed(() =>
    searching.value ? [] : groupByActivity(endedAll.value, nowMs.value),
  )

  // Flat ended list retained for the count badge and the collapsed icon rail.
  const endedRows = computed(() =>
    searching.value ? [] : endedAll.value.slice().sort(byActivityDesc),
  )

  return {
    searching,
    filteredFlat,
    matchCount,
    pinnedActive,
    activeGroups,
    endedGroups,
    endedRows,
  }
}

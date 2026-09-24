// PROTOTYPE - throwaway. Three variants of the Recall page (today /review),
// switchable via ?variant= on the existing route. Answers issue #351.
//
//   A  Ledger   - one flat ruled list, most overdue first
//   B  Dividers - grouped by source session under tabbed dividers
//   C  Stack    - one card at a time, the rest fanned behind it
//
// ?empty=1 forces the empty state. When the real queue has nothing due, fake
// items are seeded so the structures have something to bite on; the bar says
// so, and the primary action on a fake item is stubbed (no session created).
import { ref } from 'vue'

export const VARIANTS = [
  { key: 'A', name: 'Ledger' },
  { key: 'B', name: 'Dividers by source' },
  { key: 'C', name: 'Card stack' },
]

const STORAGE_KEY = 'proto-recall-variant'

function readStored() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || 'A'
  } catch {
    return 'A'
  }
}

export const variant = ref(readStored())

export function setVariant(v) {
  variant.value = v
  try {
    sessionStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* ignore */
  }
}

export const fakeData = ref(false)

const HOUR = 3_600_000
const DAY = 24 * HOUR

function ago(ms) {
  return new Date(Date.now() - ms).toISOString()
}

// Eight items across three source sessions, overdue from two hours to nine
// days, streaks 0-4, so ordering and grouping both show.
export function fakeItems() {
  const s1 = { id: 'fake-photosynthesis', topic: 'Photosynthesis' }
  const s2 = { id: 'fake-limits', topic: 'Limits and continuity' }
  const s3 = { id: 'fake-cold-war', topic: 'Origins of the Cold War' }
  return [
    mk('Calvin cycle', s1, 4, 9 * DAY, 30 * DAY),
    mk('Light-dependent reactions', s1, 2, 6 * DAY, 14 * DAY),
    mk('Epsilon-delta definition of a limit', s2, 1, 3 * DAY, 6 * DAY),
    mk('Stomata and gas exchange', s1, 3, 2 * DAY, 16 * DAY),
    mk('Squeeze theorem', s2, 0, 1 * DAY, 2 * DAY),
    mk('Containment policy', s3, 2, 20 * HOUR, 8 * DAY),
    mk('Removable vs jump discontinuities', s2, 1, 5 * HOUR, 4 * DAY),
    mk('Marshall Plan', s3, 1, 2 * HOUR, 3 * DAY),
  ]
}

function mk(concept, session, streak, overdueBy, lastTestedAgo) {
  return {
    concept,
    source_session_id: session.id,
    source_topic: session.topic,
    streak,
    due_at: ago(overdueBy),
    last_tested_at: ago(lastTestedAgo),
    fake: true,
  }
}

// "due 3 days ago" style copy from due_at. Short units so it fits a row.
export function dueSince(dueAt, now = Date.now()) {
  const ms = now - new Date(dueAt).getTime()
  if (ms < HOUR) return 'due now'
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    return `due ${h} hour${h === 1 ? '' : 's'} ago`
  }
  const d = Math.floor(ms / DAY)
  if (d === 1) return 'due yesterday'
  if (d < 14) return `due ${d} days ago`
  const w = Math.floor(d / 7)
  return `due ${w} weeks ago`
}

// Days overdue, for anything that wants to weigh urgency (the stack fans by it).
export function daysOverdue(dueAt, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(dueAt).getTime()) / DAY))
}

export function streakLabel(streak) {
  if (!streak) return 'not yet held'
  return streak === 1 ? '1 correct in a row' : `${streak} correct in a row`
}

// Group items by source session, preserving queue order (most overdue first)
// both across groups and within them.
export function groupBySource(items) {
  const map = new Map()
  for (const it of items) {
    let g = map.get(it.source_session_id)
    if (!g) {
      g = { id: it.source_session_id, topic: it.source_topic, items: [] }
      map.set(it.source_session_id, g)
    }
    g.items.push(it)
  }
  return [...map.values()]
}

// PROTOTYPE - throwaway. Do not ship.
//
// Question (wayfinder ticket #338): with the /review page gone, how should
// "N concepts due for review" sit on the session rows in the sidebar?
//
// Three variants on the existing sidebar, switchable via ?variant=A|B|C and
// the floating bar at the bottom of the screen:
//   A  Count pill on the row ("2 due"), amber ring on the collapsed dot.
//   B  Second line under the topic naming the due concepts.
//   C  A "Due for review" divider section at the top of the active list,
//      with concept chips that deep-link into the session.
// In every variant the ended-session banner names the first due concept.
//
// Data: the real queue (GET /review/queue, limit 100) grouped by
// source_session_id. If the account has nothing due, FAKE items are pinned to
// the first two sessions so the marker is visible.
import { computed, ref } from 'vue'
import { getReviewQueue } from '@/services/reviewApi.js'

export const VARIANTS = [
  { key: 'A', name: 'Count pill on row' },
  { key: 'B', name: 'Due line under topic' },
  { key: 'C', name: 'Due divider section' },
]

const STORAGE_KEY = 'proto-due-variant'

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
    // ignore
  }
}

// sessionId -> [ReviewQueueItem]
export const dueBySession = ref({})
export const fakeData = ref(false)

export const dueTotal = computed(() =>
  Object.values(dueBySession.value).reduce((n, list) => n + list.length, 0),
)

export function dueFor(sessionId) {
  return dueBySession.value[sessionId] || []
}

const FAKE = [
  ['Bayes theorem', 3],
  ['Conditional probability', 1],
  ['Law of total probability', 2],
  ['Light-dependent reactions', 1],
]

let loaded = false

export async function loadDue(sessions) {
  if (loaded) return
  loaded = true
  const items = await getReviewQueue({ limit: 100, offset: 0 }, { silent: true })
    .then((page) => page?.items || [])
    .catch(() => [])
  const map = {}
  for (const it of items) {
    ;(map[it.source_session_id] ||= []).push(it)
  }
  if (!items.length && sessions?.length) {
    fakeData.value = true
    const [s0, s1] = sessions
    const mk = (s, rows) =>
      rows.map(([concept, streak]) => ({
        concept,
        streak,
        source_session_id: s.id,
        source_topic: s.topic,
      }))
    map[s0.id] = mk(s0, FAKE.slice(0, 3))
    if (s1) map[s1.id] = mk(s1, FAKE.slice(3))
  }
  dueBySession.value = map
}

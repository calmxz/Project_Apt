import { ref } from 'vue'

// State machine for the start pages: lookup -> intercept -> level -> create.
// Lookup is an enhancement: any failure falls through to the level picker.
export function useStartFlow({ store, router, beforeNavigate }) {
  const stage = ref('idle') // 'idle' | 'intercept' | 'level'
  const busy = ref(false)
  const interceptMatch = ref(null)
  const interceptKind = ref(null) // 'active' | 'ended' | null
  const topic = ref('')
  let generation = 0

  async function begin(rawTopic) {
    const trimmed = (rawTopic || '').trim()
    if (!trimmed || busy.value) return
    topic.value = trimmed
    busy.value = true
    const gen = generation
    try {
      const res = await store.lookupTopic(trimmed)
      if (gen !== generation) return
      if (res?.active_match) {
        interceptMatch.value = res.active_match
        interceptKind.value = 'active'
        stage.value = 'intercept'
      } else if (res?.ended_match) {
        interceptMatch.value = res.ended_match
        interceptKind.value = 'ended'
        stage.value = 'intercept'
      } else {
        stage.value = 'level'
      }
    } finally {
      busy.value = false
    }
  }

  function openExisting() {
    router.push({ name: 'session', params: { id: interceptMatch.value.session_id } })
  }

  async function continuePrior() {
    if (busy.value) return
    busy.value = true
    try {
      const created = await store.continueTopic({
        id: interceptMatch.value.session_id,
        topic: interceptMatch.value.title,
        ended_at: interceptMatch.value.ended_at,
      })
      if (created) router.push({ name: 'session', params: { id: created.id } })
    } finally {
      busy.value = false
    }
  }

  function startFresh() {
    stage.value = 'level'
  }

  async function _create({ declaredLevel = null, quiz = false } = {}) {
    if (busy.value) return
    busy.value = true
    try {
      const created = await store.createSession({
        topic: topic.value,
        seedMode: 'fresh',
        priorSessionId: null,
        declaredLevel,
      })
      if (!created) return
      if (beforeNavigate) await beforeNavigate(created)
      const route = { name: 'session', params: { id: created.id } }
      if (quiz) route.query = { quiz: '1' }
      router.push(route)
    } catch (e) {
      if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
        // Race backstop: a session appeared between lookup and create.
        interceptMatch.value = { session_id: e.body.detail.session_id, title: topic.value }
        interceptKind.value = 'active'
        stage.value = 'intercept'
        return
      }
      throw e
    } finally {
      busy.value = false
    }
  }

  const pickLevel = (level) => _create({ declaredLevel: level })
  const pickQuiz = () => _create({ quiz: true })
  const skipLevel = () => _create()

  function cancel() {
    generation += 1
    stage.value = 'idle'
    interceptMatch.value = null
    interceptKind.value = null
  }

  return {
    stage,
    busy,
    interceptMatch,
    interceptKind,
    begin,
    openExisting,
    continuePrior,
    startFresh,
    pickLevel,
    pickQuiz,
    skipLevel,
    cancel,
  }
}

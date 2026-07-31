import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as sessionsApi from '../services/sessionsApi.js'
import { streamChat, streamCheckComplete } from '../services/chatStreamService.js'
import { reportCostWarning } from '../services/costBus.js'
import { friendlyError } from '../lib/errors.js'
import { mapCapError } from '../lib/capErrors.js'
import { createDeltaBatcher } from '../lib/deltaBatcher.js'

function toUiMessage(m) {
  return {
    role: m.role,
    content: m.content,
    message_id: m.id,
    citations: m.citations || [],
    created_at: m.created_at,
    status: m.status,
    check_batch: m.check_batch
      ? {
          gap: m.check_batch.gap,
          total: m.check_batch.total,
          items: (m.check_batch.items || []).map((it) => ({
            question: it.question,
            options: it.options || [],
            status: it.status,
            selectedIndex: it.selected_index,
            correctIndex: it.correct_index,
            correct: it.correct,
            explanation: it.explanation,
          })),
        }
      : null,
  }
}

export const useSessionStore = defineStore('session', () => {
  const currentSessionId = ref(null)
  const currentSession = ref(null)
  // NOT the full corpus: a SIDEBAR_PAGE_LIMIT-sized window per status
  // (20 active + 20 ended), refilled only by listSessions().
  const sessions = ref([])
  // The sidebar's server-side search results. Owned by the store rather than
  // by Sidebar.vue because the sidebar RENDERS these row objects directly and
  // they routinely describe sessions outside the `sessions` window: every
  // mutating action below must be able to patch them, or an action taken on a
  // search row would update nothing the user can see.
  const searchRows = ref([])
  // Server-capped sidebar page size; totals let the UI say "View all N".
  const SIDEBAR_PAGE_LIMIT = 20
  // activeTotal / endedTotal are a LOCAL MIRROR of the server's per-status
  // counts. They are NOT derived from `sessions` (which is only a window) and
  // they are reconciled with the server in exactly two places: listSessions()
  // and reset(). Every listSessions() call site is mount-time (HomeView,
  // NewSessionView, Sidebar onMounted) and nothing refetches after a mutation
  // -- deliberately, since a refetch costs a round-trip and re-sorts the
  // sidebar under the user mid-action. So any transition a mutating action
  // fails to mirror here persists for the life of the page.
  // CONTRACT for any new action that moves a session between active and
  // ended: it must move these too, using the shared rule documented on
  // _observedRows() below.
  const activeTotal = ref(0)
  const endedTotal = ref(0)
  const messages = ref([])
  // P3: pagination for the last-30 transcript window loadSession returns.
  const hasMoreMessages = ref(false)
  const loadingEarlier = ref(false)
  const loadEarlierError = ref(null)
  const loading = ref(false)
  const detailLoading = ref(false)
  const error = ref(null)
  const dailyCapInfo = ref(null) // { cap, used, resets_at }
  const dailyCapReached = computed(() => dailyCapInfo.value !== null)
  const costCapInfo = ref(null) // { used_usd, soft_cap_usd, hard_cap_usd, resets_at }
  const costCapReached = computed(() => costCapInfo.value !== null)
  // Set by endSession so an open SessionView can show its closing summary
  // dialog regardless of *where* the End action was triggered (sidebar row
  // menu, future shortcuts, etc.). SessionView consumes and clears it.
  const pendingSummary = ref(null) // { sessionId, kind, text } | null
  // I-05: set by reopenSession on a 409 duplicate_topic conflict so the UI
  // can offer a real affordance (go to the conflicting active session)
  // instead of a dead-end error. Cleared on the next reopen attempt and on
  // navigation (loadSession) so it never survives past its own screen.
  const duplicateReopen = ref(null) // { sessionId } | null

  // Library-scoped state — never touches sidebar sessions/loading/error
  const libraryLoading = ref(false)
  const libraryError = ref(null)

  // In-flight-promise guard. Holds ONLY pending promises (deleted on settle),
  // never resolved results — so a reused promise is as fresh as a new request
  // and carries no invalidation surface. De-dupes the double GET /sessions on
  // home load and collapses concurrent same-id detail loads. NOT a cache.
  const _inflight = new Map()
  // Tracks the most recently requested detail id so an out-of-order resolution
  // (A->B->A, B resolving last) cannot clobber currentSession/messages for the
  // session the user is actually viewing. Module-scoped (not reactive).
  let _latestRequestedId = null

  async function fetchLibrary(params) {
    libraryLoading.value = true
    libraryError.value = null
    try {
      return await sessionsApi.getSessionLibrary(params)
    } catch (e) {
      libraryError.value = e?.message || 'Failed to load sessions'
      throw e
    } finally {
      libraryLoading.value = false
    }
  }

  // Every locally-held object that represents session `id`: the sidebar
  // window, the sidebar's server-side search results, and the open session
  // detail. `extra` lets a caller add the row it is itself holding and
  // rendering (continueTopic's `prior`, which the library page draws from its
  // own items array the store never sees). Together these are the ONLY
  // observations the store has of a session's active/ended state.
  //
  // SHARED TOTALS RULE (endSession / reopenSession / continueTopic):
  //   move the totals unless EVERY observed copy already shows the target
  //   state -- in that case the transition was counted when it first
  //   happened. With nothing observed we cannot see the state at all, so we
  //   count the transition rather than guess it away: the row is simply
  //   outside every loaded window, and its server-side count still moved.
  // This is what makes a replay harmless. The server treats end and reopen as
  // idempotent (200 on replay, backend/routes/sessions.py), and because every
  // row the UI can act on is observed, a second call finds the row already in
  // the target state and leaves the totals alone.
  function _observedRows(id, extra = null) {
    const held = []
    const i = sessions.value.findIndex((s) => s.id === id)
    if (i !== -1) held.push(sessions.value[i])
    const j = searchRows.value.findIndex((s) => s.id === id)
    if (j !== -1) held.push(searchRows.value[j])
    if (currentSession.value?.id === id) held.push(currentSession.value)
    if (extra && extra.id === id && !held.includes(extra)) held.push(extra)
    return held
  }

  // Route a backend cap envelope (HTTP 429 detail or SSE error payload)
  // into the cap-banner refs. Unknown codes are a no-op.
  function _applyCapError(detail) {
    const { kind, info } = mapCapError(detail)
    if (kind === 'daily') dailyCapInfo.value = info
    else if (kind === 'cost') costCapInfo.value = info
  }

  function _setError(e) {
    error.value = friendlyError(e)
    throw e
  }

  function setError(msg) {
    error.value = msg
  }

  async function listSessions() {
    if (_inflight.has('list')) return _inflight.get('list')
    const p = (async () => {
      loading.value = true
      error.value = null
      try {
        // Boot-path fire-and-forget (HomeView + Sidebar onMounted) — silent for
        // the same reason the old listSessions wrapper was (U-05): a background
        // load must never toast.
        const [activePage, endedPage] = await Promise.all([
          sessionsApi.getSessionLibrary(
            { status: 'active', sort: 'pinned_activity', limit: SIDEBAR_PAGE_LIMIT, offset: 0 },
            { silent: true },
          ),
          sessionsApi.getSessionLibrary(
            { status: 'ended', sort: 'last_activity', limit: SIDEBAR_PAGE_LIMIT, offset: 0 },
            { silent: true },
          ),
        ])
        // DECISION: Promise.all is all-or-nothing -- if either page's request
        // rejects, the other page's already-resolved items/total are discarded
        // and sessions/activeTotal/endedTotal are left at their stale pre-call
        // values (the catch block below only records the error). Accepted:
        // a half-merged window (only one status populated) is worse UX than a
        // stale-but-consistent one, and the caller can retry.
        const seen = new Set()
        const merged = []
        for (const item of [...activePage.items, ...endedPage.items]) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          merged.push(item)
        }
        sessions.value = merged
        activeTotal.value = activePage.total
        endedTotal.value = endedPage.total
        return sessions.value
      } catch (e) {
        _setError(e)
      } finally {
        loading.value = false
        _inflight.delete('list')
      }
    })()
    _inflight.set('list', p)
    return p
  }

  async function createSession({ topic, seedMode, priorSessionId, declaredLevel } = {}) {
    loading.value = true
    error.value = null
    try {
      const created = await sessionsApi.createSession({
        topic,
        seedMode,
        priorSessionId,
        declaredLevel,
      })
      // A freshly created session is always active server-side; count it
      // unconditionally even though it isn't added to the (windowed)
      // `sessions` list here.
      activeTotal.value += 1
      currentSession.value = created
      currentSessionId.value = created.id
      messages.value = []
      return created
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function lookupTopic(topic) {
    // Start-page enhancement: failure must never block session creation.
    try {
      return await sessionsApi.lookupTopic(topic)
    } catch {
      return null
    }
  }

  async function loadSession(id) {
    // F-01: switching sessions must not let the previous session's stream
    // keep running (and billing) or deliver into the incoming transcript.
    if (id !== currentSessionId.value && abortController.value) abandonStream()
    _latestRequestedId = id
    if (_inflight.has(id)) return _inflight.get(id)
    const p = (async () => {
      loading.value = true
      detailLoading.value = true
      error.value = null
      duplicateReopen.value = null
      try {
        const s = await sessionsApi.getSession(id)
        if (_latestRequestedId !== id) return s // superseded by a newer load; drop the write
        currentSession.value = s
        currentSessionId.value = s.id
        messages.value = (s.messages || []).map(toUiMessage)
        hasMoreMessages.value = !!s.has_more_messages
        loadEarlierError.value = null
        pendingCheck.value = s.pending_check
          ? {
              gap: s.pending_check.gap,
              total: s.pending_check.total,
              currentIndex: s.pending_check.current_index,
              viewIndex: s.pending_check.current_index,
              items: (s.pending_check.items || []).map((it) => ({
                question: it.question,
                options: it.options || [],
                status: it.status,
                selectedIndex: it.selected_index,
                correctIndex: it.correct_index,
                correct: it.correct,
                explanation: it.explanation,
              })),
            }
          : null
        return s
      } catch (e) {
        // Same discriminator as the success path: a superseded load (the user
        // already navigated on) must not surface its error over the session now
        // being viewed. Drop it silently — the active load owns error state.
        if (_latestRequestedId !== id) return
        _setError(e)
      } finally {
        // F-13: mirror the write discriminator - only the latest-requested
        // load may clear the shared flags, else a superseded load drops the
        // skeleton while the real target is still in flight.
        if (_latestRequestedId === id) {
          loading.value = false
          detailLoading.value = false
        }
        _inflight.delete(id)
      }
    })()
    _inflight.set(id, p)
    return p
  }

  async function loadEarlierMessages() {
    if (loadingEarlier.value || !hasMoreMessages.value) return
    const oldest = messages.value[0]?.message_id
    const sid = currentSessionId.value
    if (oldest == null || !sid) return
    loadingEarlier.value = true
    loadEarlierError.value = null
    try {
      const page = await sessionsApi.getSessionMessages(sid, { before: oldest })
      // A navigation may have swapped sessions while the page was in flight.
      if (currentSessionId.value !== sid) return
      messages.value = [...(page.items || []).map(toUiMessage), ...messages.value]
      hasMoreMessages.value = !!page.has_more
    } catch (e) {
      loadEarlierError.value = e?.message || 'Failed to load earlier messages'
    } finally {
      loadingEarlier.value = false
    }
  }

  function clearDailyCap() {
    dailyCapInfo.value = null
  }

  function clearCostCap() {
    costCapInfo.value = null
  }

  async function endSession(sessionId) {
    const id = sessionId || currentSessionId.value
    if (!id) throw new Error('no active session')
    loading.value = true
    error.value = null
    try {
      const resp = await sessionsApi.endSession(id)
      const summaryText = resp?.summary?.text ?? ''
      // Snapshot the observation BEFORE patching anything: once a copy's
      // ended_at is written it reads as "already ended" and would silently
      // swallow the totals transition below. See _observedRows for the
      // shared rule this implements.
      const observed = _observedRows(id)
      const alreadyEnded = observed.length > 0 && observed.every((r) => r.ended_at)
      for (const r of observed) r.ended_at = resp.ended_at
      if (
        currentSession.value &&
        currentSession.value.id === id &&
        resp?.summary?.kind === 'summary'
      ) {
        // F-54: only a real summary belongs in the profile; the
        // no_exchanges display sentence is UI copy, not profile state.
        currentSession.value.topic_profile = {
          ...currentSession.value.topic_profile,
          last_session_summary: summaryText,
        }
      }
      if (!alreadyEnded) {
        activeTotal.value = Math.max(0, activeTotal.value - 1)
        endedTotal.value += 1
      }
      const summary = resp?.summary
      pendingSummary.value = {
        sessionId: id,
        kind: summary?.kind || 'summary',
        text:
          summary?.text ||
          (summary?.kind === 'no_exchanges'
            ? 'This session ended without any exchanges. Start a new session to continue.'
            : 'Session ended.'),
      }
      return resp
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  function consumePendingSummary() {
    pendingSummary.value = null
  }

  async function reopenSession(sessionId) {
    loading.value = true
    error.value = null
    duplicateReopen.value = null
    try {
      const resp = await sessionsApi.reopenSession(sessionId)
      // Same reasoning as endSession: snapshot before patching.
      const observed = _observedRows(sessionId)
      const alreadyActive = observed.length > 0 && observed.every((r) => !r.ended_at)
      for (const r of observed) r.ended_at = null
      if (!alreadyActive) {
        endedTotal.value = Math.max(0, endedTotal.value - 1)
        activeTotal.value += 1
      }
      return resp
    } catch (e) {
      // I-05: the contract hands over the conflicting session id - surface
      // it as an affordance instead of the generic dead end.
      if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
        duplicateReopen.value = { sessionId: e.body.detail.session_id }
        error.value = 'An active session with this topic already exists.'
        throw e
      }
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function continueTopic(prior) {
    loading.value = true
    error.value = null
    try {
      const created = await sessionsApi.createSession({
        topic: prior.topic,
        seedMode: 'resume',
        priorSessionId: prior.id,
      })
      // Backend auto-ends the prior session on resume-create; reflect it
      // locally so ended-state UI updates without a refetch. Same
      // SHARED TOTALS RULE as endSession/reopenSession -- `prior` is exactly
      // the `extra` observation the rule was built for: the row the caller
      // itself rendered (e.g. an ended-tab row, or a library-page item)
      // outside the loaded window.
      const observed = _observedRows(prior.id, prior)
      const alreadyEnded = observed.length > 0 && observed.every((r) => r.ended_at)
      if (!alreadyEnded) {
        const endedAt = new Date().toISOString()
        for (const r of observed) r.ended_at = endedAt
      }
      // The new session is always active. The prior only moves active ->
      // ended in the totals when it was NOT already observed as ended -
      // continueTopic is only ever offered on already-ended rows in the UI,
      // so in the normal case the prior is already counted in endedTotal
      // and there is no transition to apply here.
      activeTotal.value += 1
      if (!alreadyEnded) {
        activeTotal.value = Math.max(0, activeTotal.value - 1)
        endedTotal.value += 1
      }
      currentSession.value = created
      currentSessionId.value = created.id
      messages.value = []
      return created
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function renameSession(id, topic) {
    error.value = null
    // Every observed copy is a mutation target -- a search row can be the
    // only rendered copy of a session outside the loaded window. Each copy
    // rolls back to its OWN previous value (not a shared `prev`): the window
    // copy and the search copy can legitimately disagree, e.g. the search
    // response is fresher.
    const observed = _observedRows(id)
    const prevs = observed.map((r) => r.topic)
    for (const r of observed) r.topic = topic
    try {
      return await sessionsApi.renameSession(id, topic)
    } catch (e) {
      observed.forEach((r, i) => {
        r.topic = prevs[i]
      })
      // F-07: background action - rollback and rethrow, but never write the
      // global error (it unmounts unrelated screens). Callers toast.
      throw e
    }
  }

  async function setPinned(id, pinned) {
    error.value = null
    const observed = _observedRows(id)
    const prevs = observed.map((r) => r.pinned)
    for (const r of observed) r.pinned = pinned
    try {
      return await sessionsApi.setPinned(id, pinned)
    } catch (e) {
      observed.forEach((r, i) => {
        r.pinned = prevs[i]
      })
      // F-07: background action - rollback and rethrow, but never write the
      // global error (it unmounts unrelated screens). Callers toast.
      throw e
    }
  }

  // Batch shape: { gap, total, currentIndex, viewIndex, items: [
  //   { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
  const pendingCheck = ref(null)
  // Typing mid-batch is allowed (spec section 3), so the composer never locks on
  // an open check. Kept as a computed for the SessionView/Composer binding.
  const checkLocked = computed(() => false)
  const checkAnswering = ref(false)
  const checkCompleting = ref(false)

  function handleCheckQuestion({ gap, items, total }) {
    pendingCheck.value = {
      gap,
      total: total ?? (items || []).length,
      currentIndex: 0,
      viewIndex: 0,
      items: (items || []).map((it) => ({
        question: it.question,
        options: it.options || [],
        status: 'pending',
        selectedIndex: null,
        correctIndex: null,
        correct: null,
        explanation: null,
      })),
    }
  }

  async function answerCheck(selectedIndex) {
    const id = currentSessionId.value
    const pc = pendingCheck.value
    if (!id || !pc) return
    const i = pc.currentIndex
    const item = pc.items[i]
    if (!item || item.status !== 'pending') return
    if (checkAnswering.value) return
    checkAnswering.value = true
    try {
      const resp = await sessionsApi.answerCheck(id, i, selectedIndex)
      item.status = 'answered'
      item.selectedIndex = selectedIndex
      item.correct = resp.correct
      item.correctIndex = resp.correct_index
      item.explanation = resp.explanation
      pc.currentIndex = resp.current_index
    } finally {
      checkAnswering.value = false
    }
  }

  function nextCheck() {
    const pc = pendingCheck.value
    if (pc) pc.viewIndex = pc.currentIndex
  }

  async function skipCheck() {
    const id = currentSessionId.value
    const pc = pendingCheck.value
    if (!id || !pc) return
    const i = pc.currentIndex
    const item = pc.items[i]
    if (!item || item.status !== 'pending') return
    // Same in-flight guard as answerCheck: a rapid double-skip would otherwise
    // double-POST, and the second hits a 409 (out-of-order) since currentIndex
    // already advanced.
    if (checkAnswering.value) return
    checkAnswering.value = true
    let resp
    try {
      resp = await sessionsApi.skipCheck(id, i)
      item.status = 'skipped'
      pc.currentIndex = resp.current_index
    } finally {
      checkAnswering.value = false
    }
    if (resp.done) {
      await completeCheck()
    } else {
      pc.viewIndex = pc.currentIndex
    }
  }

  async function completeCheck() {
    const id = currentSessionId.value
    if (!id || !pendingCheck.value) return
    if (checkCompleting.value) return
    // F-04: never start the follow-up stream while another stream is live --
    // both write through the shared streamingMessage/abortController, so a
    // second start would interleave two SSE streams into one bubble and
    // orphan the first stream's abort handle. The check card stays open, so
    // Done can be clicked again once the active stream settles.
    if (streamState.value !== 'idle') return
    checkCompleting.value = true
    // F-17: remember the batch until the stream is proven underway - a
    // pre-flight failure must put the card back, not strand it server-open.
    const savedCheck = pendingCheck.value
    pendingCheck.value = null
    let sawAnyEvent = false
    streamingMessage.value = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    streamState.value = 'streaming'
    _streamSid = id
    const ctrl = new AbortController()
    abortController.value = ctrl
    error.value = null
    const deltaBatcher = createDeltaBatcher(appendAssistantDelta)
    let sawTerminal = false
    try {
      await streamCheckComplete({
        sessionId: id,
        signal: ctrl.signal,
        onEvent: ({ event, data }) => {
          sawAnyEvent = true
          if (event !== 'assistant_delta') deltaBatcher.flush()
          switch (event) {
            case 'tool_call_start':
              recordToolCall({ kind: 'start', tool_call: data })
              break
            case 'tool_call_done':
              recordToolCall({ kind: 'done', tool_call: data })
              break
            case 'assistant_delta':
              deltaBatcher.push(data.text)
              break
            case 'citations':
              setCitations(data)
              break
            case 'cost_warning':
              reportCostWarning(data)
              break
            case 'check_question':
              handleCheckQuestion(data)
              break
            case 'done':
              sawTerminal = true
              finalizeMessage(data.message_id)
              break
            case 'cancelled':
              sawTerminal = true
              handleCancelled(data.message_id, data.partial_content_chars, data.estimated_cost_usd)
              break
            case 'followup_skipped':
              sawTerminal = true
              if (!_streamSuperseded()) {
                followupNotice.value =
                  'Daily message limit reached - recap saved, tutor follow-up skipped.'
              }
              streamingMessage.value = null
              streamState.value = 'idle'
              abortController.value = null
              break
            case 'error':
              sawTerminal = true
              _applyCapError(data)
              if (!_streamSuperseded()) error.value = data.message || data.code
              handleAbortError(data.code)
              break
          }
        },
      })
      deltaBatcher.flush()
      if (!sawTerminal) {
        if (!_streamSuperseded()) error.value = 'The tutor stopped responding. Please try again.'
        streamingMessage.value = null
        streamState.value = 'idle'
        abortController.value = null
      }
    } catch (e) {
      deltaBatcher.flush()
      if (_streamSuperseded()) {
        _clearStreamState()
        return
      }
      if (!sawAnyEvent && !pendingCheck.value) pendingCheck.value = savedCheck
      if (e?.name === 'AbortError') {
        if (streamingMessage.value)
          handleCancelled('pending', streamingMessage.value.content.length, '0')
        return
      }
      if (e?.status === 429) _applyCapError(e?.body?.detail)
      streamingMessage.value = null
      streamState.value = 'idle'
      abortController.value = null
      _setError(e)
    } finally {
      checkCompleting.value = false
    }
  }

  const streamingMessage = ref(null)
  const streamState = ref('idle') // 'idle' | 'streaming' | 'tool_running' | 'stopping'
  const abortController = ref(null)
  // F-01: the session id the in-flight stream belongs to. Terminal handlers
  // compare it against currentSessionId so a stream that outlived a session
  // switch can never push its output (or errors) into the new session's
  // transcript. `null` means "no stream may deliver" (abandoned).
  let _streamSid = null

  function _streamSuperseded() {
    return _streamSid !== currentSessionId.value
  }

  function _clearStreamState() {
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  function abandonStream() {
    // F-01: silently discard an in-flight stream (session switch / view
    // unmount). Unlike stopStream -- the user-visible Stop, which persists a
    // cancelled bubble -- nothing may be pushed into messages or error state.
    _streamSid = null
    if (abortController.value) abortController.value.abort()
    _clearStreamState()
  }
  const followupNotice = ref(null)

  function clearFollowupNotice() {
    followupNotice.value = null
  }

  function appendAssistantDelta(text) {
    if (!streamingMessage.value) return
    streamingMessage.value.content += text
  }

  function recordToolCall({ kind, tool_call }) {
    if (!streamingMessage.value) return
    if (kind === 'start') {
      streamingMessage.value.tool_calls.push({ ...tool_call, state: 'running' })
      streamState.value = 'tool_running'
    } else if (kind === 'done') {
      const tc = streamingMessage.value.tool_calls.find((t) => t.id === tool_call.id)
      if (tc) {
        tc.state = tool_call.status === 'error' ? 'error' : 'done'
        tc.summary = tool_call.summary
        tc.error = tool_call.error
      }
      streamState.value = 'streaming'
    }
  }

  function setCitations(citations) {
    if (!streamingMessage.value) return
    streamingMessage.value.citations = citations
  }

  function finalizeMessage(message_id) {
    if (_streamSuperseded()) {
      _clearStreamState()
      return
    }
    if (!streamingMessage.value) return
    messages.value.push({ ...streamingMessage.value, message_id, status: 'complete' })
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  function handleCancelled(message_id, partial_chars, estimated_cost_usd) {
    if (_streamSuperseded()) {
      _clearStreamState()
      return
    }
    if (!streamingMessage.value) return
    messages.value.push({
      ...streamingMessage.value,
      message_id,
      status: 'cancelled',
      partial_content_chars: partial_chars,
      estimated_cost_usd,
    })
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  // F-14: the backend persists already-streamed text on a mid-turn cost-cap
  // or max_iters abort (status 'partial'); a generic agent-loop failure
  // still persists it too, but as status 'error'. Mirror that split here so
  // the live view matches what a reload of the same session will show
  // instead of discarding the text the learner already watched stream.
  const PARTIAL_ABORT_CODES = new Set(['daily_cost_cap_reached', 'max_iters_reached'])

  function handleAbortError(code) {
    if (_streamSuperseded()) {
      _clearStreamState()
      return
    }
    if (!streamingMessage.value) return
    if (streamingMessage.value.content) {
      const status = PARTIAL_ABORT_CODES.has(code) ? 'partial' : 'error'
      messages.value.push({ ...streamingMessage.value, status })
    }
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  function stopStream() {
    if (abortController.value) {
      abortController.value.abort()
      streamState.value = 'stopping'
    }
  }

  async function sendMessageStreaming({
    text,
    reviewGaps = false,
    reviewGap = null,
    diagnosticAccepted = false,
  }) {
    if (!currentSessionId.value) throw new Error('no active session')
    const trimmed = (text || '').trim()
    if (!trimmed) return null
    // F-04 (defensive): same single-live-stream invariant as completeCheck.
    if (streamState.value !== 'idle') return null
    followupNotice.value = null
    messages.value.push({ role: 'user', content: trimmed })
    streamingMessage.value = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    streamState.value = 'streaming'
    _streamSid = currentSessionId.value
    const ctrl = new AbortController()
    abortController.value = ctrl
    error.value = null
    const deltaBatcher = createDeltaBatcher(appendAssistantDelta)
    let sawTerminal = false
    let sawAnyEvent = false
    try {
      await streamChat({
        sessionId: currentSessionId.value,
        message: trimmed,
        reviewGaps,
        reviewGap,
        diagnosticAccepted,
        signal: ctrl.signal,
        onEvent: ({ event, data }) => {
          sawAnyEvent = true
          if (event !== 'assistant_delta') deltaBatcher.flush()
          switch (event) {
            case 'tool_call_start':
              recordToolCall({ kind: 'start', tool_call: data })
              break
            case 'tool_call_done':
              recordToolCall({ kind: 'done', tool_call: data })
              break
            case 'assistant_delta':
              deltaBatcher.push(data.text)
              break
            case 'citations':
              setCitations(data)
              break
            case 'cost_warning':
              reportCostWarning(data)
              break
            case 'check_question':
              handleCheckQuestion(data)
              break
            case 'done':
              sawTerminal = true
              finalizeMessage(data.message_id)
              break
            case 'cancelled':
              sawTerminal = true
              handleCancelled(data.message_id, data.partial_content_chars, data.estimated_cost_usd)
              break
            case 'error':
              sawTerminal = true
              _applyCapError(data)
              if (!_streamSuperseded()) error.value = data.message || data.code
              handleAbortError(data.code)
              break
          }
        },
      })
      deltaBatcher.flush()
      if (!sawTerminal) {
        if (!_streamSuperseded()) error.value = 'The tutor stopped responding. Please try again.'
        streamingMessage.value = null
        streamState.value = 'idle'
        abortController.value = null
      }
    } catch (e) {
      deltaBatcher.flush()
      if (_streamSuperseded()) {
        _clearStreamState()
        return
      }
      if (e?.name === 'AbortError') {
        if (streamingMessage.value)
          handleCancelled('pending', streamingMessage.value.content.length, '0')
        return
      }
      if (!sawAnyEvent && typeof e?.status === 'number' && e.status >= 400) {
        // I-10: the server persisted nothing pre-stream - drop the
        // optimistic bubble instead of stranding it in the transcript.
        // Runs before the session_ended arm too: that 409 is itself a
        // pre-stream failure and must not strand the bubble either.
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'user' && last.message_id === undefined) messages.value.pop()
      }
      if (e?.status === 409 && e?.body?.detail?.code === 'session_ended') {
        error.value = 'This session was ended elsewhere. Reopen it to continue.'
        if (currentSession.value) currentSession.value.ended_at = new Date().toISOString()
        streamingMessage.value = null
        streamState.value = 'idle'
        abortController.value = null
        return
      }
      if (e?.status === 429) _applyCapError(e?.body?.detail)
      streamingMessage.value = null
      streamState.value = 'idle'
      abortController.value = null
      _setError(e)
    }
  }

  function reset() {
    currentSessionId.value = null
    currentSession.value = null
    sessions.value = []
    searchRows.value = []
    activeTotal.value = 0
    endedTotal.value = 0
    messages.value = []
    hasMoreMessages.value = false
    loadingEarlier.value = false
    loadEarlierError.value = null
    error.value = null
    dailyCapInfo.value = null
    costCapInfo.value = null
    pendingSummary.value = null
    duplicateReopen.value = null
    pendingCheck.value = null
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
    followupNotice.value = null
  }

  return {
    currentSessionId,
    currentSession,
    sessions,
    searchRows,
    activeTotal,
    endedTotal,
    messages,
    hasMoreMessages,
    loadingEarlier,
    loadEarlierError,
    loading,
    detailLoading,
    error,
    dailyCapReached,
    dailyCapInfo,
    costCapReached,
    costCapInfo,
    pendingSummary,
    duplicateReopen,
    consumePendingSummary,
    pendingCheck,
    checkLocked,
    streamingMessage,
    streamState,
    abortController,
    followupNotice,
    clearFollowupNotice,
    listSessions,
    createSession,
    lookupTopic,
    loadSession,
    loadEarlierMessages,
    endSession,
    reopenSession,
    continueTopic,
    renameSession,
    setPinned,
    setError,
    clearDailyCap,
    clearCostCap,
    handleCheckQuestion,
    answerCheck,
    nextCheck,
    skipCheck,
    completeCheck,
    appendAssistantDelta,
    recordToolCall,
    setCitations,
    finalizeMessage,
    handleCancelled,
    handleAbortError,
    stopStream,
    abandonStream,
    sendMessageStreaming,
    reset,
    libraryLoading,
    libraryError,
    fetchLibrary,
  }
})

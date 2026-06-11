import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as sessionsApi from '../services/sessionsApi.js'
import { postChat } from '../services/chatApi.js'
import { streamChat, streamCheckComplete } from '../services/chatStreamService.js'
import { reportCostWarning } from '../services/costBus.js'
import { friendlyError } from '../lib/errors.js'
import {
  ERR_DAILY_CAP_REACHED,
  ERR_DAILY_COST_CAP_REACHED,
} from '../lib/errorCodes.js'

export const useSessionStore = defineStore('session', () => {
  const currentSessionId = ref(null)
  const currentSession = ref(null)
  const sessions = ref([])
  const messages = ref([])
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
        sessions.value = await sessionsApi.listSessions()
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

  async function createSession({ topic, seedMode, priorSessionId } = {}) {
    loading.value = true
    error.value = null
    try {
      const created = await sessionsApi.createSession({
        topic,
        seedMode,
        priorSessionId,
      })
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

  async function loadSession(id) {
    _latestRequestedId = id
    if (_inflight.has(id)) return _inflight.get(id)
    const p = (async () => {
      loading.value = true
      detailLoading.value = true
      error.value = null
      try {
        const s = await sessionsApi.getSession(id)
        if (_latestRequestedId !== id) return s // superseded by a newer load; drop the write
        currentSession.value = s
        currentSessionId.value = s.id
        messages.value = (s.messages || []).map((m) => ({
          role: m.role,
          content: m.content,
          message_id: m.id,
          citations: m.citations || [],
          created_at: m.created_at,
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
        }))
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
        _setError(e)
      } finally {
        loading.value = false
        detailLoading.value = false
        _inflight.delete(id)
      }
    })()
    _inflight.set(id, p)
    return p
  }

  async function sendMessage({ text }) {
    if (!currentSessionId.value) throw new Error('no active session')
    const trimmed = (text || '').trim()
    if (!trimmed) return null

    messages.value.push({ role: 'user', content: trimmed })
    loading.value = true
    error.value = null
    try {
      const resp = await postChat({
        sessionId: currentSessionId.value,
        message: trimmed,
      })
      messages.value.push({
        role: 'assistant',
        content: resp.assistant_message,
        message_id: resp.message_id,
        tool_calls: resp.tool_calls || [],
        citations: resp.citations || [],
      })
      // Non-streaming fallback: rebuild the batch check card from the chat
      // response's pending_check public_view (same batch shape as loadSession).
      // Per-item grading happens later via POST /check/answer, not on this turn.
      pendingCheck.value = resp.pending_check
        ? {
            gap: resp.pending_check.gap,
            total: resp.pending_check.total,
            currentIndex: resp.pending_check.current_index,
            viewIndex: resp.pending_check.current_index,
            items: (resp.pending_check.items || []).map((it) => ({
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
      return resp
    } catch (e) {
      if (e?.status === 429 && e?.body?.detail?.code === ERR_DAILY_CAP_REACHED) {
        dailyCapInfo.value = {
          cap: e.body.detail.cap,
          used: e.body.detail.used,
          resets_at: e.body.detail.resets_at,
        }
      } else if (
        e?.status === 429 &&
        e?.body?.detail?.code === ERR_DAILY_COST_CAP_REACHED
      ) {
        costCapInfo.value = {
          used_usd: e.body.detail.used_usd,
          soft_cap_usd: e.body.detail.soft_cap_usd,
          hard_cap_usd: e.body.detail.hard_cap_usd,
          resets_at: e.body.detail.resets_at,
        }
      }
      _setError(e)
    } finally {
      loading.value = false
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
      if (currentSession.value && currentSession.value.id === id) {
        currentSession.value.ended_at = resp.ended_at
        currentSession.value.topic_profile = {
          ...currentSession.value.topic_profile,
          last_session_summary: summaryText,
        }
      }
      const idx = sessions.value.findIndex((s) => s.id === id)
      if (idx !== -1) sessions.value[idx].ended_at = resp.ended_at
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
    try {
      const resp = await sessionsApi.reopenSession(sessionId)
      if (currentSession.value && currentSession.value.id === sessionId) {
        currentSession.value.ended_at = null
      }
      const idx = sessions.value.findIndex((s) => s.id === sessionId)
      if (idx !== -1) sessions.value[idx].ended_at = null
      return resp
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function renameSession(id, topic) {
    error.value = null
    const idx = sessions.value.findIndex((s) => s.id === id)
    const prev = idx !== -1 ? sessions.value[idx].topic : null
    if (idx !== -1) sessions.value[idx].topic = topic
    if (currentSession.value?.id === id) currentSession.value.topic = topic
    try {
      return await sessionsApi.renameSession(id, topic)
    } catch (e) {
      if (idx !== -1) sessions.value[idx].topic = prev
      if (currentSession.value?.id === id) currentSession.value.topic = prev
      _setError(e)
    }
  }

  async function setPinned(id, pinned) {
    error.value = null
    const idx = sessions.value.findIndex((s) => s.id === id)
    const prev = idx !== -1 ? sessions.value[idx].pinned : null
    if (idx !== -1) sessions.value[idx].pinned = pinned
    if (currentSession.value?.id === id) currentSession.value.pinned = pinned
    try {
      return await sessionsApi.setPinned(id, pinned)
    } catch (e) {
      if (idx !== -1) sessions.value[idx].pinned = prev
      if (currentSession.value?.id === id) currentSession.value.pinned = prev
      _setError(e)
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
    checkCompleting.value = true
    pendingCheck.value = null
    streamingMessage.value = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    streamState.value = 'streaming'
    const ctrl = new AbortController()
    abortController.value = ctrl
    error.value = null
    try {
      await streamCheckComplete({
        sessionId: id,
        signal: ctrl.signal,
        onEvent: ({ event, data }) => {
          switch (event) {
            case 'tool_call_start': recordToolCall({ kind: 'start', tool_call: data }); break
            case 'tool_call_done': recordToolCall({ kind: 'done', tool_call: data }); break
            case 'assistant_delta': appendAssistantDelta(data.text); break
            case 'citations': setCitations(data); break
            case 'cost_warning': reportCostWarning(data); break
            case 'check_question': handleCheckQuestion(data); break
            case 'done': finalizeMessage(data.message_id); break
            case 'cancelled': handleCancelled(data.message_id, data.partial_content_chars, data.estimated_cost_usd); break
            case 'error':
              error.value = data.message || data.code
              streamingMessage.value = null
              streamState.value = 'idle'
              abortController.value = null
              break
          }
        },
      })
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (streamingMessage.value) handleCancelled('pending', streamingMessage.value.content.length, '0')
        return
      }
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
      if (tc) { tc.state = tool_call.status === 'error' ? 'error' : 'done'; tc.summary = tool_call.summary; tc.error = tool_call.error }
      streamState.value = 'streaming'
    }
  }

  function setCitations(citations) {
    if (!streamingMessage.value) return
    streamingMessage.value.citations = citations
  }

  function finalizeMessage(message_id) {
    if (!streamingMessage.value) return
    messages.value.push({ ...streamingMessage.value, message_id, status: 'complete' })
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  function handleCancelled(message_id, partial_chars, estimated_cost_usd) {
    if (!streamingMessage.value) return
    messages.value.push({ ...streamingMessage.value, message_id, status: 'cancelled', partial_content_chars: partial_chars, estimated_cost_usd })
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  function stopStream() {
    if (abortController.value) { abortController.value.abort(); streamState.value = 'stopping' }
  }

  async function sendMessageStreaming({ text }) {
    if (!currentSessionId.value) throw new Error('no active session')
    const trimmed = (text || '').trim()
    if (!trimmed) return null
    messages.value.push({ role: 'user', content: trimmed })
    streamingMessage.value = { role: 'assistant', content: '', tool_calls: [], citations: [] }
    streamState.value = 'streaming'
    const ctrl = new AbortController()
    abortController.value = ctrl
    error.value = null
    try {
      await streamChat({
        sessionId: currentSessionId.value,
        message: trimmed,
        signal: ctrl.signal,
        onEvent: ({ event, data }) => {
          switch (event) {
            case 'tool_call_start': recordToolCall({ kind: 'start', tool_call: data }); break
            case 'tool_call_done': recordToolCall({ kind: 'done', tool_call: data }); break
            case 'assistant_delta': appendAssistantDelta(data.text); break
            case 'citations': setCitations(data); break
            case 'cost_warning': reportCostWarning(data); break
            case 'check_question': handleCheckQuestion(data); break
            case 'done': finalizeMessage(data.message_id); break
            case 'cancelled': handleCancelled(data.message_id, data.partial_content_chars, data.estimated_cost_usd); break
            case 'error':
              error.value = data.message || data.code
              streamingMessage.value = null
              streamState.value = 'idle'
              abortController.value = null
              break
          }
        },
      })
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (streamingMessage.value) handleCancelled('pending', streamingMessage.value.content.length, '0')
        return
      }
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
    messages.value = []
    error.value = null
    dailyCapInfo.value = null
    costCapInfo.value = null
    pendingSummary.value = null
    pendingCheck.value = null
    streamingMessage.value = null
    streamState.value = 'idle'
    abortController.value = null
  }

  return {
    currentSessionId,
    currentSession,
    sessions,
    messages,
    loading,
    detailLoading,
    error,
    dailyCapReached,
    dailyCapInfo,
    costCapReached,
    costCapInfo,
    pendingSummary,
    consumePendingSummary,
    pendingCheck,
    checkLocked,
    streamingMessage,
    streamState,
    abortController,
    listSessions,
    createSession,
    loadSession,
    sendMessage,
    endSession,
    reopenSession,
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
    stopStream,
    sendMessageStreaming,
    reset,
    libraryLoading,
    libraryError,
    fetchLibrary,
  }
})

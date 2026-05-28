import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as sessionsApi from '../services/sessionsApi.js'
import { postChat } from '../services/chatApi.js'
import { streamChat } from '../services/chatStreamService.js'
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
  const error = ref(null)
  const dailyCapInfo = ref(null) // { cap, used, resets_at }
  const dailyCapReached = computed(() => dailyCapInfo.value !== null)
  const costCapInfo = ref(null) // { used_usd, soft_cap_usd, hard_cap_usd, resets_at }
  const costCapReached = computed(() => costCapInfo.value !== null)

  function _setError(e) {
    error.value = friendlyError(e)
    throw e
  }

  function setError(msg) {
    error.value = msg
  }

  async function listSessions() {
    loading.value = true
    error.value = null
    try {
      sessions.value = await sessionsApi.listSessions()
      return sessions.value
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
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
    loading.value = true
    error.value = null
    try {
      const s = await sessionsApi.getSession(id)
      currentSession.value = s
      currentSessionId.value = s.id
      messages.value = (s.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        message_id: m.id,
        citations: m.citations || [],
        created_at: m.created_at,
      }))
      return s
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
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

  async function endSession() {
    if (!currentSessionId.value) throw new Error('no active session')
    loading.value = true
    error.value = null
    try {
      const resp = await sessionsApi.endSession(currentSessionId.value)
      const summaryText = resp?.summary?.text ?? ''
      if (currentSession.value) {
        currentSession.value.ended_at = resp.ended_at
        currentSession.value.topic_profile = {
          ...currentSession.value.topic_profile,
          last_session_summary: summaryText,
        }
      }
      const idx = sessions.value.findIndex((s) => s.id === currentSessionId.value)
      if (idx !== -1) sessions.value[idx].ended_at = resp.ended_at
      return resp
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
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
      if (tc) { tc.state = tool_call.status === 'error' ? 'error' : 'done'; tc.summary = tool_call.summary }
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
    error,
    dailyCapReached,
    dailyCapInfo,
    costCapReached,
    costCapInfo,
    streamingMessage,
    streamState,
    abortController,
    listSessions,
    createSession,
    loadSession,
    sendMessage,
    endSession,
    reopenSession,
    setError,
    clearDailyCap,
    clearCostCap,
    appendAssistantDelta,
    recordToolCall,
    setCitations,
    finalizeMessage,
    handleCancelled,
    stopStream,
    sendMessageStreaming,
    reset,
  }
})

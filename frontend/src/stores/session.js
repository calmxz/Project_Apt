import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as sessionsApi from '../services/sessionsApi.js'
import { postChat } from '../services/chatApi.js'
import { ERR_DAILY_CAP_REACHED } from '../lib/errorCodes.js'

export const useSessionStore = defineStore('session', () => {
  const currentSessionId = ref(null)
  const currentSession = ref(null)
  const sessions = ref([])
  const messages = ref([])
  const loading = ref(false)
  const error = ref(null)
  const dailyCapInfo = ref(null) // { cap, used, resets_at }
  const dailyCapReached = computed(() => dailyCapInfo.value !== null)

  function _setError(e) {
    error.value = e instanceof Error ? e.message : String(e)
    throw e
  }

  function setError(msg) {
    error.value = msg
  }

  async function listSessions(userId) {
    loading.value = true
    error.value = null
    try {
      sessions.value = await sessionsApi.listSessions(userId)
      return sessions.value
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function createSession({ userId, topic, seedMode, priorSessionId } = {}) {
    loading.value = true
    error.value = null
    try {
      const created = await sessionsApi.createSession({
        userId,
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

  async function loadSession(id, userId) {
    loading.value = true
    error.value = null
    try {
      const s = await sessionsApi.getSession(id, userId)
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

  async function sendMessage({ userId, text }) {
    if (!currentSessionId.value) throw new Error('no active session')
    const trimmed = (text || '').trim()
    if (!trimmed) return null

    messages.value.push({ role: 'user', content: trimmed })
    loading.value = true
    error.value = null
    try {
      const resp = await postChat({
        sessionId: currentSessionId.value,
        userId,
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
      }
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  function clearDailyCap() {
    dailyCapInfo.value = null
  }

  async function endSession(userId) {
    if (!currentSessionId.value) throw new Error('no active session')
    loading.value = true
    error.value = null
    try {
      const resp = await sessionsApi.endSession(currentSessionId.value, userId)
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

  async function reopenSession(sessionId, userId) {
    loading.value = true
    error.value = null
    try {
      const resp = await sessionsApi.reopenSession(sessionId, userId)
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

  function reset() {
    currentSessionId.value = null
    currentSession.value = null
    sessions.value = []
    messages.value = []
    error.value = null
    dailyCapInfo.value = null
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
    listSessions,
    createSession,
    loadSession,
    sendMessage,
    endSession,
    reopenSession,
    setError,
    clearDailyCap,
    reset,
  }
})

import { ref } from 'vue'
import { defineStore } from 'pinia'

import * as sessionsApi from '../services/sessionsApi.js'
import { postChat } from '../services/chatApi.js'

export const useSessionStore = defineStore('session', () => {
  const currentSessionId = ref(null)
  const currentSession = ref(null)
  const sessions = ref([])
  const messages = ref([])
  const loading = ref(false)
  const error = ref(null)

  function _setError(e) {
    error.value = e instanceof Error ? e.message : String(e)
    throw e
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

  async function loadSession(id) {
    loading.value = true
    error.value = null
    try {
      const s = await sessionsApi.getSession(id)
      currentSession.value = s
      currentSessionId.value = s.id
      // Backend does not yet return historical messages on GET /sessions/{id};
      // SessionView starts with empty transcript and appends from sendMessage.
      messages.value = []
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
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function endSession() {
    if (!currentSessionId.value) throw new Error('no active session')
    loading.value = true
    error.value = null
    try {
      const resp = await sessionsApi.endSession(currentSessionId.value)
      if (currentSession.value) {
        currentSession.value.ended_at = resp.ended_at
        currentSession.value.topic_profile = {
          ...currentSession.value.topic_profile,
          last_session_summary: resp.summary,
        }
      }
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
  }

  return {
    currentSessionId,
    currentSession,
    sessions,
    messages,
    loading,
    error,
    listSessions,
    createSession,
    loadSession,
    sendMessage,
    endSession,
    reset,
  }
})

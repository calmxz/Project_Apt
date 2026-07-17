import { ref } from 'vue'
import { defineStore } from 'pinia'

// Phase 7+: identity comes from `useAuthStore` (Supabase JWT). This store
// only persists local UX preferences -- name + feedback style + onboarding
// completion -- in a localStorage entry namespaced by Supabase userId so two
// accounts on one browser never share prefs (F-08).

const STORAGE_PREFIX = 'crux:user:v1'

export const useUserStore = defineStore('user', () => {
  const name = ref(null)
  const interactionPreferences = ref(null)
  const onboardingComplete = ref(false)
  // Supabase uid the in-memory state belongs to; null = signed out.
  const activeUserId = ref(null)
  // F-46: whether hydrateFromServer has completed (success or failure) for
  // the current active user. The router guard awaits one hydrate before
  // trusting onboardingComplete, so a new device doesn't get force-routed
  // through onboarding off a stale/absent localStorage snapshot.
  const hydrated = ref(false)

  function _storageKey() {
    return `${STORAGE_PREFIX}:${activeUserId.value}`
  }

  function _clearInMemory() {
    name.value = null
    interactionPreferences.value = null
    onboardingComplete.value = false
    hydrated.value = false
  }

  function setActiveUser(uid) {
    const next = uid ?? null
    if (next === activeUserId.value) return
    activeUserId.value = next
    _clearInMemory()
    if (next) loadFromLocalStorage()
  }

  function loadFromLocalStorage() {
    if (typeof localStorage === 'undefined' || !activeUserId.value) return
    const raw = localStorage.getItem(_storageKey())
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      name.value = data.name ?? null
      interactionPreferences.value = data.interactionPreferences ?? null
      onboardingComplete.value = Boolean(data.onboardingComplete)
    } catch {
      localStorage.removeItem(_storageKey())
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined' || !activeUserId.value) return
    localStorage.setItem(
      _storageKey(),
      JSON.stringify({
        name: name.value,
        interactionPreferences: interactionPreferences.value,
        onboardingComplete: onboardingComplete.value,
      }),
    )
  }

  // F-46: server is authoritative for onboarding state; localStorage is a
  // warm cache only. A failed hydrate (offline / API down) keeps whatever
  // localStorage already loaded rather than blocking the app.
  async function hydrateFromServer() {
    if (!activeUserId.value) return
    try {
      const { apiGet } = await import('../services/apiClient.js')
      const me = await apiGet('/me', undefined, { silent: true })
      if (me) {
        if (me.display_name != null) name.value = me.display_name
        if (me.feedback_pref != null) {
          interactionPreferences.value = {
            ...interactionPreferences.value,
            feedback: me.feedback_pref,
          }
        }
        onboardingComplete.value = Boolean(me.onboarding_complete)
        persist()
      }
    } catch {
      // Offline / API down: keep the localStorage snapshot already loaded.
    } finally {
      hydrated.value = true
    }
  }

  async function completeOnboarding({ name: displayName, feedback }) {
    const finalName = displayName?.trim() || 'Learner'
    const { apiPatch } = await import('../services/apiClient.js')
    await apiPatch('/me', {
      display_name: finalName,
      feedback_pref: feedback,
      onboarding_complete: true,
    })
    name.value = finalName
    interactionPreferences.value = { feedback }
    onboardingComplete.value = true
    persist()
  }

  function resetOnboarding() {
    _clearInMemory()
    if (typeof localStorage !== 'undefined' && activeUserId.value) {
      localStorage.removeItem(_storageKey())
    }
  }

  async function updateProfile({ name: displayName, feedback }) {
    const body = {}
    if (displayName != null) body.display_name = displayName.trim() || 'Learner'
    if (feedback != null) body.feedback_pref = feedback
    if (Object.keys(body).length) {
      const { apiPatch } = await import('../services/apiClient.js')
      await apiPatch('/me', body)
    }
    if (displayName != null) name.value = displayName.trim() || 'Learner'
    if (feedback != null) {
      interactionPreferences.value = { ...interactionPreferences.value, feedback }
    }
    persist()
  }

  return {
    name,
    interactionPreferences,
    onboardingComplete,
    activeUserId,
    hydrated,
    setActiveUser,
    loadFromLocalStorage,
    hydrateFromServer,
    completeOnboarding,
    resetOnboarding,
    updateProfile,
  }
})

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

  function _storageKey() {
    return `${STORAGE_PREFIX}:${activeUserId.value}`
  }

  function _clearInMemory() {
    name.value = null
    interactionPreferences.value = null
    onboardingComplete.value = false
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

  function completeOnboarding({ name: displayName, feedback }) {
    name.value = displayName?.trim() || 'Learner'
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

  function updateProfile({ name: displayName, feedback }) {
    if (displayName != null) name.value = displayName.trim() || 'Learner'
    if (feedback != null) {
      interactionPreferences.value = {
        ...interactionPreferences.value,
        feedback,
      }
    }
    persist()
  }

  return {
    name,
    interactionPreferences,
    onboardingComplete,
    activeUserId,
    setActiveUser,
    loadFromLocalStorage,
    completeOnboarding,
    resetOnboarding,
    updateProfile,
  }
})

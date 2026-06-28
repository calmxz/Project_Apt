import { ref } from 'vue'
import { defineStore } from 'pinia'

// Phase 7+: identity comes from `useAuthStore` (Supabase JWT). This store
// only persists local UX preferences — name + feedback style + onboarding
// completion — keyed off Supabase userId at the auth-store boundary, not
// here. The legacy `userId` field has been removed.

const STORAGE_KEY = 'crux:user:v1'

export const useUserStore = defineStore('user', () => {
  const name = ref(null)
  const interactionPreferences = ref(null)
  const onboardingComplete = ref(false)

  function loadFromLocalStorage() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      name.value = data.name ?? null
      interactionPreferences.value = data.interactionPreferences ?? null
      onboardingComplete.value = Boolean(data.onboardingComplete)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      STORAGE_KEY,
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
    name.value = null
    interactionPreferences.value = null
    onboardingComplete.value = false
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
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
    loadFromLocalStorage,
    completeOnboarding,
    resetOnboarding,
    updateProfile,
  }
})

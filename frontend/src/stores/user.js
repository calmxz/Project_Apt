import { ref } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'adaptlearn:user:v1'

function generateUserId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const useUserStore = defineStore('user', () => {
  const userId = ref(null)
  const name = ref(null)
  const interactionPreferences = ref(null)
  const onboardingComplete = ref(false)

  function loadFromLocalStorage() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      userId.value = data.userId ?? null
      name.value = data.name ?? null
      interactionPreferences.value = data.interactionPreferences ?? null
      onboardingComplete.value = Boolean(data.onboardingComplete)
    } catch {
      // Corrupt entry — drop it so onboarding can recover.
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId: userId.value,
        name: name.value,
        interactionPreferences: interactionPreferences.value,
        onboardingComplete: onboardingComplete.value,
      }),
    )
  }

  function completeOnboarding({ name: displayName, feedback }) {
    if (!userId.value) userId.value = generateUserId()
    name.value = displayName?.trim() || 'Learner'
    interactionPreferences.value = { feedback }
    onboardingComplete.value = true
    persist()
  }

  function resetOnboarding() {
    userId.value = null
    name.value = null
    interactionPreferences.value = null
    onboardingComplete.value = false
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }

  return {
    userId,
    name,
    interactionPreferences,
    onboardingComplete,
    loadFromLocalStorage,
    completeOnboarding,
    resetOnboarding,
  }
})

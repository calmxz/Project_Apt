import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', () => {
  const userId = ref(null)
  const name = ref(null)
  const interactionPreferences = ref(null)
  const onboardingComplete = ref(false)

  return { userId, name, interactionPreferences, onboardingComplete }
})

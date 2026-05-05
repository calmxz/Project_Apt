import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', () => {
  const currentSessionId = ref(null)
  const messages = ref([])

  return { currentSessionId, messages }
})

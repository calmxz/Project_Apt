<template>
  <section class="new-session">
    <h1>Start a session</h1>

    <div class="form">
      <div class="field">
        <label for="topic">Topic</label>
        <InputText
          id="topic"
          v-model="topic"
          data-testid="new-topic"
          placeholder="e.g. Recursion"
          autocomplete="off"
        />
      </div>

      <div class="field">
        <label>Mode</label>
        <SelectButton
          v-model="seedMode"
          :options="modeOptions"
          option-label="label"
          option-value="value"
          data-testid="new-mode"
          :allow-empty="false"
        />
      </div>

      <div v-if="seedMode === 'resume'" class="field">
        <label for="prior">Continue from</label>
        <Select
          id="prior"
          v-model="priorSessionId"
          :options="resumableSessions"
          option-label="label"
          option-value="value"
          data-testid="new-prior"
          placeholder="Pick a previous session"
          :loading="store.loading"
        />
        <p v-if="!resumableSessions.length && !store.loading" class="help">
          No prior ended sessions on this topic yet.
        </p>
      </div>

      <p v-if="error" class="error" data-testid="new-error">{{ error }}</p>

      <Button
        label="Create session"
        data-testid="new-submit"
        :disabled="!canSubmit || store.loading"
        @click="submit"
      />
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'

import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'

const router = useRouter()
const store = useSessionStore()
const user = useUserStore()

const topic = ref('')
const seedMode = ref('fresh')
const priorSessionId = ref(null)
const error = ref(null)

const modeOptions = [
  { label: 'Fresh', value: 'fresh' },
  { label: 'Resume', value: 'resume' },
]

onMounted(async () => {
  if (user.userId && !store.sessions.length) {
    await store.listSessions(user.userId).catch(() => {})
  }
})

const resumableSessions = computed(() => {
  const t = topic.value.trim().toLowerCase()
  if (!t) return []
  return store.sessions
    .filter((s) => s.ended_at && s.topic.toLowerCase() === t)
    .map((s) => ({
      label: `${s.topic} — ended ${new Date(s.ended_at).toLocaleString()}`,
      value: s.id,
    }))
})

const canSubmit = computed(() => {
  if (!topic.value.trim()) return false
  if (seedMode.value === 'resume' && !priorSessionId.value) return false
  return true
})

async function submit() {
  error.value = null
  try {
    const created = await store.createSession({
      userId: user.userId,
      topic: topic.value.trim(),
      seedMode: seedMode.value,
      priorSessionId: seedMode.value === 'resume' ? priorSessionId.value : null,
    })
    router.push({ name: 'session', params: { id: created.id } })
  } catch (e) {
    error.value = e?.message || 'Failed to create session.'
  }
}
</script>

<style scoped>
.new-session {
  max-width: 36rem;
  margin: 0 auto;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-top: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.help {
  margin: 0;
  color: var(--color-text-muted, #888);
  font-size: 0.875rem;
}
.error {
  color: #c33;
  margin: 0;
}
</style>

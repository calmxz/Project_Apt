<template>
  <section class="new-session">
    <BackButton />
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
        <p class="help">
          To continue an ended topic, reopen it from the Ended tab on Home.
        </p>
      </div>

      <div
        v-if="activeOnTopic"
        class="warn"
        data-testid="new-active-warn"
      >
        <p class="warn-line">
          You already have an active session on
          <strong>"{{ activeOnTopic.topic }}"</strong>
          (#{{ shortId(activeOnTopic.id) }}, started {{ formatRelative(activeOnTopic.created_at) }}).
        </p>
        <Button
          label="Open existing"
          severity="secondary"
          data-testid="new-open-existing"
          @click="openExisting"
        />
      </div>

      <p v-if="error" class="error" data-testid="new-error">{{ error }}</p>

      <Button
        label="Create session"
        data-testid="new-submit"
        :disabled="!canSubmit || store.loading || dupeBlocked"
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

import BackButton from '../components/BackButton.vue'
import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'
import { findActiveSessionByTopic, formatRelative, shortId } from '../utils/formatDate.js'

const router = useRouter()
const store = useSessionStore()
const user = useUserStore()

const topic = ref('')
const error = ref(null)

onMounted(async () => {
  // Reuse cache if HomeView already loaded the list this navigation cycle.
  if (user.userId && !store.sessions.length) {
    await store.listSessions(user.userId).catch(() => {})
  }
})

// Block fresh creation when a live session already exists on the same topic.
const activeOnTopic = computed(() =>
  findActiveSessionByTopic(store.sessions, topic.value),
)

const dupeBlocked = computed(() => Boolean(activeOnTopic.value))

const canSubmit = computed(() => Boolean(topic.value.trim()))

function openExisting() {
  if (!activeOnTopic.value) return
  router.push({ name: 'session', params: { id: activeOnTopic.value.id } })
}

async function submit() {
  error.value = null
  if (dupeBlocked.value) {
    error.value = 'An active session for this topic already exists.'
    return
  }
  try {
    const created = await store.createSession({
      userId: user.userId,
      topic: topic.value.trim(),
      seedMode: 'fresh',
      priorSessionId: null,
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
.warn {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border-strong);
  border-left: 3px solid var(--color-accent);
  background: var(--color-surface);
  border-radius: var(--radius-md);
}
.warn-line {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
}
.warn-line strong {
  color: var(--color-heading);
}
</style>

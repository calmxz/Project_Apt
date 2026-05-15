<template>
  <section class="session">
    <header class="head">
      <div>
        <h1 class="topic">{{ store.currentSession?.topic || 'Session' }}</h1>
        <p class="muted" data-testid="session-id">id: {{ id }}</p>
      </div>
      <Button
        label="End session"
        icon="pi pi-flag"
        severity="secondary"
        data-testid="session-end"
        :disabled="!canEnd"
        @click="end"
      />
    </header>

    <div class="messages" data-testid="session-messages">
      <p v-if="!store.messages.length" class="muted">
        Send a message below to begin.
      </p>
      <Card
        v-for="(m, i) in store.messages"
        :key="i"
        :class="['msg', m.role]"
        :data-testid="`msg-${m.role}`"
      >
        <template #content>
          <p class="content">{{ m.content }}</p>
          <ul v-if="m.citations && m.citations.length" class="citations">
            <li v-for="(c, j) in m.citations" :key="j">{{ c.doc_id }}: {{ c.text }}</li>
          </ul>
        </template>
      </Card>
    </div>

    <p v-if="store.error" class="error" data-testid="session-error">{{ store.error }}</p>

    <div class="composer">
      <Textarea
        v-model="draft"
        data-testid="session-input"
        rows="2"
        auto-resize
        placeholder="Ask a question or share what you know..."
        :disabled="!canSend"
      />
      <Button
        label="Send"
        icon="pi pi-send"
        data-testid="session-send"
        :disabled="!draft.trim() || !canSend || store.loading"
        @click="send"
      />
    </div>

    <Dialog
      v-model:visible="summaryDialog"
      header="Session ended"
      modal
      :closable="true"
      data-testid="session-summary-dialog"
    >
      <p class="summary">{{ summaryText }}</p>
      <template #footer>
        <Button label="Close" data-testid="session-summary-close" @click="goHome" />
      </template>
    </Dialog>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import Card from 'primevue/card'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'

import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'

const props = defineProps({ id: { type: String, required: true } })

const router = useRouter()
const store = useSessionStore()
const user = useUserStore()

const draft = ref('')
const summaryDialog = ref(false)
const summaryText = ref('')

const canEnd = computed(() => Boolean(store.currentSession && !store.currentSession.ended_at))
const canSend = computed(() => canEnd.value)

onMounted(async () => {
  await store.loadSession(props.id).catch(() => {})
})

async function send() {
  const text = draft.value
  draft.value = ''
  try {
    await store.sendMessage({ userId: user.userId, text })
  } catch {
    draft.value = text
  }
}

async function end() {
  try {
    const resp = await store.endSession()
    summaryText.value = resp?.summary || 'Session ended.'
    summaryDialog.value = true
  } catch {
    /* error already surfaced via store.error */
  }
}

function goHome() {
  summaryDialog.value = false
  router.push({ name: 'home' })
}
</script>

<style scoped>
.session {
  max-width: 48rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.topic {
  margin: 0 0 0.25rem 0;
}
.muted {
  color: var(--color-text-muted, #888);
  margin: 0;
  font-size: 0.875rem;
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 12rem;
}
.msg.user {
  align-self: flex-end;
  max-width: 85%;
  background: var(--p-primary-50, #eef);
}
.msg.assistant {
  align-self: flex-start;
  max-width: 85%;
}
.content {
  margin: 0;
  white-space: pre-wrap;
}
.citations {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
}
.composer {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
.composer :deep(.p-inputtextarea) {
  flex: 1;
}
.error {
  color: #c33;
  margin: 0;
}
.summary {
  white-space: pre-wrap;
}
</style>

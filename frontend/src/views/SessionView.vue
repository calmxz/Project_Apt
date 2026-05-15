<template>
  <section class="session">
    <header class="head">
      <div class="head-text">
        <span class="folio">in session</span>
        <h1 class="topic">{{ store.currentSession?.topic || 'Session' }}</h1>
        <p class="muted" data-testid="session-id">id · {{ id }}</p>
      </div>
      <Button
        label="End session"
        icon="pi pi-flag"
        icon-pos="right"
        severity="secondary"
        data-testid="session-end"
        :disabled="!canEnd"
        class="end-btn"
        @click="end"
      />
    </header>

    <hr class="hairline" />

    <div class="messages" data-testid="session-messages">
      <p v-if="!store.messages.length" class="empty">
        <span class="empty-eyebrow">begin</span>
        <span class="empty-line">Send a question or share what you already know.</span>
      </p>
      <article
        v-for="(m, i) in store.messages"
        :key="i"
        :class="['msg', m.role]"
        :data-testid="`msg-${m.role}`"
      >
        <span class="role-tag">{{ m.role === 'user' ? 'you' : 'tutor' }}</span>
        <p class="content">{{ m.content }}</p>
        <ul v-if="m.citations && m.citations.length" class="citations">
          <li v-for="(c, j) in m.citations" :key="j">
            <span class="citation-id">{{ c.doc_id }}</span>
            <span class="citation-text">{{ c.text }}</span>
          </li>
        </ul>
      </article>
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
        class="composer-input"
      />
      <Button
        label="Send"
        icon="pi pi-send"
        icon-pos="right"
        data-testid="session-send"
        :disabled="!draft.trim() || !canSend || store.loading"
        class="send-btn"
        @click="send"
      />
    </div>

    <Dialog
      v-model:visible="summaryDialog"
      header="Session ended"
      modal
      :closable="true"
      data-testid="session-summary-dialog"
      class="summary-dialog"
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
  gap: 1.5rem;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.folio {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.topic {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 400;
  font-variation-settings: 'opsz' 144;
  letter-spacing: var(--tracking-display);
  line-height: 1.15;
  color: var(--color-heading);
  margin: 0;
}

.muted {
  color: var(--color-text-faint);
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  letter-spacing: 0.04em;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  min-height: 14rem;
  padding: 0.5rem 0;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 2rem 0;
  margin: 0;
}

.empty-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.empty-line {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 1.25rem;
  color: var(--color-text-muted);
}

.msg {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-width: 100%;
}

.role-tag {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.msg.user {
  align-self: flex-end;
  max-width: 85%;
  text-align: right;
}

.msg.user .role-tag {
  color: var(--color-accent);
}

.msg.user .content {
  display: inline-block;
  background: var(--color-accent-soft);
  color: var(--color-text);
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-md) var(--radius-md) 2px var(--radius-md);
  text-align: left;
}

.msg.assistant {
  align-self: flex-start;
  max-width: 90%;
  padding-left: 1rem;
  border-left: 2px solid var(--color-border-strong);
}

.content {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  line-height: 1.6;
  color: var(--color-text);
}

.msg.user .content {
  font-family: var(--font-sans);
  font-size: 0.9375rem;
}

.citations {
  margin: 0.625rem 0 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-faint);
}

.citations li {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.citation-id {
  color: var(--color-accent);
  font-weight: 500;
  flex-shrink: 0;
}

.citation-text {
  color: var(--color-text-muted);
}

.composer {
  display: flex;
  gap: 0.625rem;
  align-items: flex-end;
  padding: 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-paper);
  position: sticky;
  bottom: 1rem;
}

.composer-input :deep(textarea),
.composer-input.p-inputtext {
  flex: 1;
  background: transparent;
  border: 0;
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--color-text);
  resize: none;
  padding: 0.5rem;
  width: 100%;
}

.composer-input :deep(textarea):focus,
.composer-input.p-inputtext:focus {
  outline: none;
  box-shadow: none;
}

.composer :deep(.p-inputtextarea) {
  flex: 1;
}

.send-btn :deep(.p-button),
.send-btn.p-button {
  background: var(--color-heading);
  color: var(--color-background);
  border: 1px solid var(--color-heading);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.625rem 1.125rem;
  border-radius: var(--radius-sm);
  transition: background 180ms ease;
}

.send-btn :deep(.p-button):not(:disabled):hover,
.send-btn.p-button:not(:disabled):hover {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.end-btn :deep(.p-button),
.end-btn.p-button {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-strong);
  font-family: var(--font-sans);
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  transition: all 180ms ease;
}

.end-btn :deep(.p-button):not(:disabled):hover,
.end-btn.p-button:not(:disabled):hover {
  color: var(--signal-error);
  border-color: var(--signal-error);
}

.error {
  color: var(--signal-error);
  margin: 0;
  font-size: var(--fs-caption);
}

.summary {
  white-space: pre-wrap;
  font-family: var(--font-serif);
  font-size: 1rem;
  line-height: 1.6;
}
</style>

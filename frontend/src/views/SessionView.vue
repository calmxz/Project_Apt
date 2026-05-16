<template>
  <section class="session">
    <BackButton />

    <div v-if="notFound" class="not-found" data-testid="session-not-found">
      <span class="folio">404</span>
      <h1 class="topic">Session not found</h1>
      <p class="not-found-sub">
        The session id <code>{{ id }}</code> doesn't exist or was deleted.
      </p>
      <router-link to="/" class="home-link" data-testid="session-not-found-home">
        &larr; Back to sessions
      </router-link>
    </div>

    <template v-else>
      <header class="head">
        <div class="head-text">
          <span class="folio">{{ isEnded ? 'archived' : 'in session' }}</span>
          <h1 class="topic">{{ store.currentSession?.topic || 'Session' }}</h1>
          <p class="muted" data-testid="session-id">id · {{ id }}</p>
        </div>
        <div class="head-actions">
          <router-link
            :to="{ name: 'session-profile', params: { id } }"
            class="profile-link profile-link-compact"
            data-testid="session-profile-link"
            aria-label="View this session's profile"
          >
            <i class="pi pi-id-card" aria-hidden="true" />
            <span>Profile</span>
          </router-link>
          <Button
            v-if="!isEnded"
            label="End session"
            icon="pi pi-flag"
            icon-pos="right"
            severity="secondary"
            data-testid="session-end"
            :disabled="!canEnd"
            class="end-btn"
            @click="end"
          />
        </div>
      </header>

      <div
        v-if="store.dailyCapReached"
        class="cap-banner"
        role="alert"
        data-testid="session-cap-banner"
      >
        <strong>Daily limit reached.</strong>
        <span v-if="store.dailyCapInfo">
          {{ store.dailyCapInfo.used }}/{{ store.dailyCapInfo.cap }} requests today.
          Resets at {{ formatShortDateTime(store.dailyCapInfo.resets_at) || 'midnight UTC' }}.
        </span>
      </div>

      <hr class="hairline" />

      <SessionEndedBanner
        v-if="isEnded"
        :ended-at="store.currentSession.ended_at"
        :loading="resuming"
        @resume="resume"
      />

      <div ref="messagesEl" class="messages" data-testid="session-messages">
        <div v-if="!store.messages.length && !isEnded" class="empty" data-testid="session-empty">
          <span class="empty-eyebrow">begin</span>
          <p class="empty-line">Send a question or share what you already know.</p>
          <div class="quick-prompts">
            <button
              v-for="(p, i) in quickPrompts"
              :key="i"
              type="button"
              class="quick-prompt"
              :data-testid="`quick-prompt-${i}`"
              @click="useQuickPrompt(p)"
            >
              {{ p }}
            </button>
          </div>
        </div>
        <p v-if="!store.messages.length && isEnded" class="empty">
          <span class="empty-eyebrow">archive</span>
          <span class="empty-line">No transcript stored for this session.</span>
        </p>
        <TransitionGroup name="msg-fade" tag="div" class="msg-list">
          <article
            v-for="(m, i) in store.messages"
            :key="m.message_id || `m-${i}`"
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
        </TransitionGroup>
        <article
          v-if="awaitingResponse"
          class="msg assistant typing"
          data-testid="msg-typing"
        >
          <span class="role-tag">tutor</span>
          <p class="content typing-dots" aria-label="Tutor is thinking">
            <span></span><span></span><span></span>
          </p>
        </article>
      </div>

      <div
        v-if="store.error || lastError"
        class="error-banner"
        role="alert"
        data-testid="session-error"
      >
        <p class="error-message">{{ friendlyError(lastError || store.error) }}</p>
        <button
          v-if="canRetry"
          type="button"
          class="error-retry"
          data-testid="session-error-retry"
          @click="retryLastMessage"
        >
          Retry
        </button>
        <details v-if="rawErrorDetail" class="error-details">
          <summary>Technical details</summary>
          <pre>{{ rawErrorDetail }}</pre>
        </details>
      </div>

      <p
        v-if="uploadStatus"
        class="upload-status"
        :data-testid="`upload-status-${uploadStatus.kind}`"
        :class="`upload-status-${uploadStatus.kind}`"
      >
        {{ uploadStatus.text }}
      </p>

      <div v-if="!isEnded" class="composer">
        <input
          ref="fileInputEl"
          type="file"
          accept="application/pdf"
          data-testid="session-upload-input"
          hidden
          @change="onUploadFile"
        />
        <button
          type="button"
          class="attach-btn"
          data-testid="session-upload-btn"
          :disabled="!canSend || uploading"
          aria-label="Attach a PDF to this session"
          @click="openFilePicker"
        >
          <span class="attach-icon" aria-hidden="true">+</span>
          <span class="attach-label">{{ uploading ? 'Uploading…' : 'Attach PDF' }}</span>
        </button>
        <Textarea
          ref="composerEl"
          v-model="draft"
          data-testid="session-input"
          rows="2"
          auto-resize
          placeholder="Ask a question. Press Enter to send, Shift+Enter for a new line."
          :disabled="!canSend"
          class="composer-input"
          @keydown="onKeydown"
        />
        <Button
          label="Send"
          icon="pi pi-send"
          icon-pos="right"
          data-testid="session-send"
          :loading="sending"
          :disabled="!draft.trim() || !canSend || sending"
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
        <p
          class="summary"
          :data-testid="`session-summary-${summaryKind}`"
        >
          {{ summaryText }}
        </p>
        <template #footer>
          <Button label="Close" data-testid="session-summary-close" @click="goHome" />
        </template>
      </Dialog>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'

import BackButton from '../components/BackButton.vue'
import SessionEndedBanner from '../components/SessionEndedBanner.vue'
import { friendlyError } from '../lib/errors.js'
import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'
import { useToast } from '../composables/useToast.js'
import { getUploadStatus, uploadPdf } from '../services/uploadApi.js'
import { formatShortDateTime } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })

const router = useRouter()
const store = useSessionStore()
const user = useUserStore()

const draft = ref('')
const lastSentText = ref('')
const summaryDialog = ref(false)
const summaryText = ref('')
const summaryKind = ref('summary')
const notFound = ref(false)
const resuming = ref(false)
const sending = ref(false)
const messagesEl = ref(null)
const composerEl = ref(null)
const fileInputEl = ref(null)
const uploading = ref(false)
const uploadStatus = ref(null)
const lastError = ref(null)

const isEnded = computed(() => Boolean(store.currentSession?.ended_at))
const canEnd = computed(() => Boolean(store.currentSession && !store.currentSession.ended_at))
const canSend = computed(() => canEnd.value && !store.dailyCapReached)

const { showError } = useToast()
watch(
  () => store.dailyCapReached,
  (now) => {
    if (!now || !store.dailyCapInfo) return
    const when = formatShortDateTime(store.dailyCapInfo.resets_at) || 'midnight UTC'
    showError(
      `Daily limit reached (${store.dailyCapInfo.used}/${store.dailyCapInfo.cap}). Resets at ${when}.`,
      { summary: 'Cap reached', life: 8000 },
    )
  },
)

// Show the "typing" placeholder when we've appended the user message but the
// tutor reply hasn't arrived yet. Driven by `sending` rather than `store.loading`
// so list-load spinners don't flicker the placeholder.
const awaitingResponse = computed(() => {
  if (!sending.value) return false
  const last = store.messages[store.messages.length - 1]
  return !last || last.role === 'user'
})

const quickPrompts = [
  'Where should I start with this topic?',
  'Quiz me on what I should already know.',
  "Explain the core idea in two sentences.",
]

function scrollToBottom() {
  nextTick(() => {
    const el = messagesEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(
  [() => store.messages.length, awaitingResponse],
  () => scrollToBottom(),
)

onMounted(async () => {
  try {
    await store.loadSession(props.id)
  } catch (e) {
    if (e?.status === 404) {
      notFound.value = true
      store.setError(null)
    }
  }
  if (!isEnded.value && !notFound.value) focusComposer()
})

function focusComposer() {
  nextTick(() => {
    const inner = composerEl.value?.$el?.querySelector?.('textarea')
    inner?.focus()
  })
}

function onKeydown(ev) {
  // Enter sends; Shift+Enter inserts a newline. Block while a request is
  // already in flight so spam-enter doesn't pile up duplicate sends.
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault()
    if (draft.value.trim() && canSend.value && !sending.value) send()
  }
}

function useQuickPrompt(text) {
  draft.value = text
  focusComposer()
}

const canRetry = computed(() => Boolean(lastSentText.value) && !sending.value && !isEnded.value)

const rawErrorDetail = computed(() => {
  const e = lastError.value || (store.error ? { message: store.error } : null)
  if (!e || typeof e !== 'object') return null
  const parts = []
  if (e.status != null) parts.push(`status: ${e.status}`)
  if (e.path) parts.push(`path: ${e.path}`)
  if (e.body) parts.push(`body: ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body)}`)
  return parts.length ? parts.join('\n') : null
})

async function send() {
  const text = draft.value
  if (!text.trim()) return
  draft.value = ''
  lastSentText.value = text
  lastError.value = null
  sending.value = true
  try {
    await store.sendMessage({ userId: user.userId, text })
    lastSentText.value = ''
  } catch (e) {
    draft.value = text
    lastError.value = e
  } finally {
    sending.value = false
  }
}

async function retryLastMessage() {
  if (!lastSentText.value) return
  draft.value = lastSentText.value
  await send()
}

async function end() {
  try {
    const resp = await store.endSession()
    const summary = resp?.summary
    summaryKind.value = summary?.kind || 'summary'
    summaryText.value =
      summary?.text || (summary?.kind === 'no_exchanges'
        ? 'This session ended without any exchanges. Start a new session to continue.'
        : 'Session ended.')
    summaryDialog.value = true
  } catch {
    /* error already surfaced via store.error */
  }
}

function openFilePicker() {
  fileInputEl.value?.click()
}

async function onUploadFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  uploading.value = true
  uploadStatus.value = { kind: 'pending', text: `Uploading ${file.name}…` }
  try {
    const resp = await uploadPdf({ sessionId: props.id, file })
    await pollUploadStatus(resp.document_id, file.name)
  } catch (e) {
    uploadStatus.value = {
      kind: 'failed',
      text: `Upload failed: ${friendlyError(e)}`,
    }
  } finally {
    uploading.value = false
  }
}

async function pollUploadStatus(documentId, filename) {
  for (let i = 0; i < 30; i += 1) {
    let s
    try {
      s = await getUploadStatus(documentId)
    } catch (e) {
      uploadStatus.value = { kind: 'failed', text: `Upload status unavailable: ${friendlyError(e)}` }
      return
    }
    if (s.status === 'ready') {
      uploadStatus.value = { kind: 'ready', text: `${filename} is ready. Ask a question about it.` }
      return
    }
    if (s.status === 'failed') {
      uploadStatus.value = {
        kind: 'failed',
        text: `Upload failed: ${s.error || 'ingestion error'}`,
      }
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  uploadStatus.value = {
    kind: 'pending',
    text: `${filename} is still processing. You can keep asking while it finishes.`,
  }
}

async function resume() {
  if (!store.currentSession) return
  resuming.value = true
  try {
    await store.reopenSession(store.currentSession.id)
  } catch {
    // store.error already populated
  } finally {
    resuming.value = false
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
  overflow-wrap: anywhere;
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
  gap: 1.25rem;
  min-height: 14rem;
  max-height: calc(100vh - 22rem);
  overflow-y: auto;
  padding: 0.5rem 0.25rem 0.5rem 0;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}

.msg-list {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.msg-fade-enter-active,
.msg-fade-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}

.msg-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.msg-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 2rem 0;
  margin: 0;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.quick-prompt {
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: 999px;
  padding: 0.4rem 0.875rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  color: var(--color-text);
  cursor: pointer;
  transition: all 180ms ease;
}

.quick-prompt:hover,
.quick-prompt:focus-visible {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-heading);
  outline: none;
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

.msg.typing .content {
  display: inline-flex;
  gap: 0.3rem;
  padding: 0.625rem 0;
  align-items: center;
}

.typing-dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-faint);
  animation: typing-bob 1200ms ease-in-out infinite;
}

.typing-dots span:nth-child(2) {
  animation-delay: 200ms;
}

.typing-dots span:nth-child(3) {
  animation-delay: 400ms;
}

@keyframes typing-bob {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.error-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.875rem 1.125rem;
  background: var(--color-accent-soft, rgba(207, 138, 138, 0.18));
  border: 1px solid var(--color-border-strong, #b78b8b);
  border-radius: var(--radius-md, 6px);
  color: var(--color-text, inherit);
}

.error-message {
  margin: 0;
  flex: 1 1 auto;
  font-family: var(--font-sans);
  font-size: 0.95rem;
}

.error-retry {
  flex: 0 0 auto;
  background: transparent;
  color: var(--color-heading);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  padding: 0.35rem 0.875rem;
  font-family: var(--font-sans);
  cursor: pointer;
}

.error-retry:hover,
.error-retry:focus-visible {
  background: var(--color-accent-soft);
  outline: none;
}

.error-details {
  flex: 1 0 100%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-faint);
}

.error-details pre {
  white-space: pre-wrap;
  margin: 0.4rem 0 0;
}

.upload-status {
  margin: 0;
  padding: 0.5rem 0.875rem;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  border-radius: var(--radius-sm, 4px);
  background: var(--color-accent-soft);
  color: var(--color-text-muted);
}

.upload-status-ready {
  color: var(--color-heading);
}

.upload-status-failed {
  background: var(--color-accent-soft, rgba(207, 138, 138, 0.18));
  color: var(--color-heading);
}

.attach-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm, 4px);
  padding: 0.5rem 0.75rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  cursor: pointer;
  flex: 0 0 auto;
  align-self: stretch;
}

.attach-btn:hover:not(:disabled),
.attach-btn:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-heading);
  outline: none;
}

.attach-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.attach-icon {
  font-weight: 600;
  font-size: 1rem;
  line-height: 1;
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

.head-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.cap-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--signal-error);
  border-left: 3px solid var(--signal-error);
  background: color-mix(in srgb, var(--signal-error) 8%, transparent);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: 0.9375rem;
}

.cap-banner strong { color: var(--signal-error); }

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

.not-found {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 2rem 0;
  max-width: 36rem;
}

.not-found-sub {
  margin: 0;
  color: var(--color-text-muted);
}

.not-found code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  padding: 0.125rem 0.375rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.home-link {
  display: inline-block;
  margin-top: 0.75rem;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
  text-decoration: none;
}

.home-link:hover,
.home-link:focus-visible {
  color: var(--color-heading);
  outline: none;
}
</style>

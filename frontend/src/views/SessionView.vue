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
          <svg
            class="empty-spark"
            viewBox="0 0 24 24"
            width="40"
            height="40"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M12 0.5 L13.6 10.4 L23.5 12 L13.6 13.6 L12 23.5 L10.4 13.6 L0.5 12 L10.4 10.4 Z"
              fill="currentColor"
            />
          </svg>
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
        <div v-if="!store.messages.length && isEnded" class="empty archived-empty">
          <span class="empty-eyebrow">archive</span>
          <span class="empty-line">No transcript stored for this session.</span>
        </div>
        <TransitionGroup name="msg-fade" tag="div" class="msg-list">
          <article
            v-for="(m, i) in store.messages"
            :key="m.message_id || `m-${i}`"
            :class="['msg', m.role]"
            :data-testid="`msg-${m.role}`"
          >
            <span v-if="m.role === 'assistant'" class="msg-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                <path
                  d="M12 0.5 L13.6 10.4 L23.5 12 L13.6 13.6 L12 23.5 L10.4 13.6 L0.5 12 L10.4 10.4 Z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <div class="msg-body">
              <span class="role-tag">{{ m.role === 'user' ? 'you' : 'tutor' }}</span>
              <p class="content">{{ m.content }}</p>
              <ul v-if="m.citations && m.citations.length" class="citations">
                <li v-for="(c, j) in m.citations" :key="j">
                  <span class="citation-id">{{ c.doc_id }}</span>
                  <span class="citation-text">{{ c.text }}</span>
                </li>
              </ul>
            </div>
          </article>
        </TransitionGroup>
        <article
          v-if="awaitingResponse"
          class="msg assistant typing"
          data-testid="msg-typing"
        >
          <span class="msg-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
              <path
                d="M12 0.5 L13.6 10.4 L23.5 12 L13.6 13.6 L12 23.5 L10.4 13.6 L0.5 12 L10.4 10.4 Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <div class="msg-body">
            <span class="role-tag">tutor</span>
            <p class="content typing-dots" aria-label="Tutor is thinking">
              <span></span><span></span><span></span>
            </p>
          </div>
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
        header="Nice work!"
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
    const resp = await uploadPdf({ userId: user.userId, sessionId: props.id, file })
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
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent);
}

.topic {
  font-family: var(--font-display);
  font-size: clamp(1.875rem, 4vw, 2.25rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
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
  gap: 1rem;
  min-height: 14rem;
  max-height: calc(100vh - 22rem);
  overflow-y: auto;
  padding: 0.5rem 0.25rem 1rem 0;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.messages::-webkit-scrollbar { width: 6px; }
.messages::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}

.msg-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.msg-fade-enter-active,
.msg-fade-leave-active {
  transition: opacity var(--motion-base) ease, transform var(--motion-base) var(--motion-bounce);
}

.msg-fade-enter-from { opacity: 0; transform: translateY(8px); }
.msg-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  margin: 0;
}

.empty-spark {
  color: var(--color-accent);
  margin-bottom: 0.25rem;
  filter: drop-shadow(0 2px 8px rgba(255, 107, 92, 0.25));
}

.empty-eyebrow {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent);
}

.empty-line {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.archived-empty .empty-eyebrow {
  color: var(--color-text-muted);
}
.archived-empty .empty-line {
  color: var(--color-text-muted);
  font-weight: 500;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  max-width: 36rem;
}

.quick-prompt {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.5rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.quick-prompt:hover,
.quick-prompt:focus-visible {
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
  color: var(--color-accent);
  transform: translateY(-1px);
  outline: none;
}

/* Messages */
.msg {
  display: flex;
  gap: 0.625rem;
  max-width: 100%;
  align-items: flex-start;
}

.msg-avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  margin-top: 0.125rem;
}

.msg-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  max-width: calc(100% - 2.6rem);
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-faint);
}

.msg.user {
  flex-direction: row-reverse;
  align-self: flex-end;
  max-width: 88%;
}

.msg.user .msg-body {
  align-items: flex-end;
  text-align: left;
  max-width: 100%;
}

.msg.user .role-tag {
  color: var(--color-accent);
}

.msg.user .content {
  display: inline-block;
  background: var(--color-accent);
  color: #FFFFFF;
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  text-align: left;
  box-shadow: 0 4px 12px -4px rgba(255, 107, 92, 0.35);
}

.msg.assistant {
  align-self: flex-start;
  max-width: 95%;
}

.msg.assistant .content {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
  box-shadow: var(--shadow-paper);
}

.content {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--color-text);
}

.citations {
  margin: 0.625rem 0 0;
  padding: 0.625rem 0.875rem;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-family: var(--font-sans);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
  border-radius: var(--radius-md);
  border: 1px dashed var(--color-border);
}

.citations li {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.citation-id {
  color: var(--color-accent);
  font-weight: 600;
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.citation-text {
  color: var(--color-text-muted);
}

.msg.typing .content {
  display: inline-flex;
  gap: 0.3rem;
  padding: 0.875rem 1.125rem;
  align-items: center;
}

.typing-dots span {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: typing-bob 1200ms ease-in-out infinite;
}

.typing-dots span:nth-child(2) { animation-delay: 200ms; }
.typing-dots span:nth-child(3) { animation-delay: 400ms; }

@keyframes typing-bob {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-5px); opacity: 1; }
}

/* Banners */
.error-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.875rem 1.125rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  color: var(--color-text);
}

.error-message {
  margin: 0;
  flex: 1 1 auto;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
}

.error-retry {
  flex: 0 0 auto;
  background: var(--signal-error);
  color: #FFFFFF;
  border: 0;
  border-radius: var(--radius-pill);
  padding: 0.4rem 0.875rem;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: filter var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.error-retry:hover,
.error-retry:focus-visible {
  filter: brightness(1.08);
  transform: translateY(-1px);
  outline: none;
}

.error-details {
  flex: 1 0 100%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.error-details pre {
  white-space: pre-wrap;
  margin: 0.4rem 0 0;
}

.upload-status {
  margin: 0;
  padding: 0.5rem 0.875rem;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  align-self: flex-start;
  display: inline-block;
}

.upload-status-ready {
  background: rgba(34, 197, 94, 0.12);
  color: var(--signal-success);
}

.upload-status-failed {
  background: rgba(239, 68, 68, 0.12);
  color: var(--signal-error);
}

/* Composer */
.composer {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.5rem 0.5rem 0.875rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-lift);
  position: sticky;
  bottom: 1rem;
  transition: border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease;
}

.composer:focus-within {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-lift), 0 0 0 4px var(--color-accent-ring);
}

.composer-input :deep(textarea),
.composer-input.p-inputtext {
  flex: 1;
  background: transparent;
  border: 0;
  font-family: var(--font-sans);
  font-size: 1rem;
  color: var(--color-text);
  resize: none;
  padding: 0.625rem 0.5rem;
  width: 100%;
  min-height: 2.5rem;
}

.composer-input :deep(textarea):focus,
.composer-input.p-inputtext:focus {
  outline: none;
  box-shadow: none;
}

.composer :deep(.p-inputtextarea) {
  flex: 1;
  border: 0;
  background: transparent;
}

.attach-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.5rem 0.875rem;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.attach-btn:hover:not(:disabled),
.attach-btn:focus-visible {
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  outline: none;
}

.attach-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.attach-icon {
  font-weight: 700;
  font-size: 1rem;
  line-height: 1;
}

.attach-label { display: inline-block; }

.send-btn :deep(.p-button),
.send-btn.p-button {
  width: 2.75rem;
  height: 2.75rem;
  min-width: 2.75rem;
  padding: 0;
  background: var(--color-accent);
  color: #FFFFFF;
  border: 0;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-weight: 600;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce), box-shadow var(--motion-fast) ease, opacity var(--motion-fast) ease;
}

.send-btn :deep(.p-button .p-button-label) {
  display: none;
}

.send-btn :deep(.p-button .p-icon),
.send-btn :deep(.p-button .pi) {
  margin: 0;
  font-size: 1rem;
}

.send-btn :deep(.p-button):not(:disabled):hover {
  transform: translateY(-2px);
}

.send-btn :deep(.p-button):not(:disabled):active {
  transform: translateY(4px);
  box-shadow: var(--shadow-pop-pressed);
}

.send-btn :deep(.p-button):disabled {
  opacity: 0.45;
  box-shadow: none;
  cursor: not-allowed;
}

/* Header action buttons */
.end-btn :deep(.p-button),
.end-btn.p-button {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.end-btn :deep(.p-button):not(:disabled):hover {
  color: var(--signal-error);
  border-color: var(--signal-error);
  background: rgba(239, 68, 68, 0.08);
  transform: translateY(-1px);
}

.head-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

/* Cap banner — pill style */
.cap-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.125rem;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  font-size: 0.9375rem;
}

.cap-banner strong {
  color: var(--signal-error);
  font-weight: 700;
}

.error {
  color: var(--signal-error);
  margin: 0;
  font-size: var(--fs-caption);
}

/* End-session summary dialog */
.summary {
  white-space: pre-wrap;
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text);
  padding: 0.5rem 0;
}

:global(.summary-dialog .p-dialog) {
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lift);
}

:global(.summary-dialog .p-dialog-header) {
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  font-size: 1.5rem;
  padding: 1.25rem 1.5rem 0.75rem;
}

:global(.summary-dialog .p-dialog-content) {
  padding: 0.5rem 1.5rem 1.25rem;
}

:global(.summary-dialog .p-dialog-footer .p-button) {
  background: var(--accent-coral-500);
  color: #FFFFFF;
  border: 0;
  border-radius: var(--radius-pill);
  padding: 0.625rem 1.5rem;
  font-weight: 600;
  box-shadow: var(--shadow-pop);
}

/* Not-found */
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
  padding: 0.125rem 0.4rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.home-link {
  display: inline-block;
  margin-top: 0.75rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-accent);
  text-decoration: none;
}

.home-link:hover,
.home-link:focus-visible {
  color: var(--color-accent-hover);
  outline: none;
}
</style>

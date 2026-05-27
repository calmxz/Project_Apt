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
      <ChatHeader :session="store.currentSession" :id="id" @end-session="end" />

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

      <div
        v-if="store.costCapReached"
        class="cap-banner"
        role="alert"
        data-testid="session-cost-cap-banner"
      >
        <strong>Daily cost limit reached.</strong>
        <span v-if="store.costCapInfo">
          ${{ store.costCapInfo.used_usd }} of ${{ store.costCapInfo.hard_cap_usd }} spent today.
          Resets at {{ formatShortDateTime(store.costCapInfo.resets_at) || 'midnight UTC' }}.
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
              <template v-if="m.role === 'assistant' && (m.tool_calls || []).length">
                <span
                  v-for="(tc, ti) in m.tool_calls"
                  :key="`tc-${ti}`"
                  class="tool-call-row"
                >
                  <ToolCallChip :tool_call="tc" state="done" />
                </span>
              </template>
              <MarkdownContent class="content" :text="m.content || ''" />
              <CitationsList v-if="m.role === 'assistant'" :citations="m.citations || []" />
            </div>
          </article>
        </TransitionGroup>
        <article
          v-if="awaitingResponse && !store.streamingMessage"
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
        <article
          v-if="store.streamingMessage"
          class="msg assistant streaming"
          data-testid="msg-streaming"
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
            <span
              v-for="tc in store.streamingMessage.tool_calls"
              :key="tc.id"
              class="tool-call-row"
            >
              <ToolCallChip :tool_call="tc" :state="tc.state" />
            </span>
            <MarkdownContent class="content" :text="store.streamingMessage.content || ''" streaming />
            <CitationsList :citations="store.streamingMessage.citations || []" />
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

      <div v-if="!isEnded" class="composer-wrap">
        <input
          ref="fileInputEl"
          type="file"
          accept="application/pdf"
          data-testid="session-upload-input"
          hidden
          @change="onUploadFile"
        />
        <div class="composer" :class="{ 'is-disabled': !canSend }">
          <button
            type="button"
            class="composer-attach"
            data-testid="session-upload-btn"
            :disabled="!canSend || uploading"
            :aria-label="uploading ? 'Uploading PDF' : 'Attach a PDF'"
            :title="uploading ? 'Uploading…' : 'Attach PDF'"
            @click="openFilePicker"
          >
            <i v-if="!uploading" class="pi pi-paperclip" aria-hidden="true" />
            <i v-else class="pi pi-spin pi-spinner" aria-hidden="true" />
          </button>

          <textarea
            ref="composerEl"
            v-model="draft"
            data-testid="session-input"
            class="composer-input"
            rows="1"
            placeholder="Ask anything. Press Enter to send · Shift + Enter for a new line."
            :disabled="!canSend"
            :maxlength="MAX_DRAFT_LEN"
            @keydown="onKeydown"
            @input="autoResize"
          />

          <button
            type="button"
            class="composer-send"
            data-testid="session-send"
            :disabled="!draft.trim() || !canSend || sending"
            :aria-label="sending ? 'Sending message' : 'Send message'"
            @click="send"
          >
            <i
              :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-arrow-up'"
              aria-hidden="true"
            />
          </button>
        </div>

        <div class="composer-hints" :class="{ 'is-near-limit': nearCharLimit }">
          <span class="composer-hint">
            <kbd>⏎</kbd> to send
            <span class="composer-hint-sep">·</span>
            <kbd>⇧</kbd>+<kbd>⏎</kbd> newline
          </span>
          <span v-if="draft.length" class="composer-count" aria-live="polite">
            {{ draft.length.toLocaleString() }} / {{ MAX_DRAFT_LEN.toLocaleString() }}
          </span>
        </div>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import BackButton from '../components/BackButton.vue'
import ChatHeader from '../components/chat/ChatHeader.vue'
import SessionEndedBanner from '../components/SessionEndedBanner.vue'
import MarkdownContent from '../components/chat/MarkdownContent.vue'
import ToolCallChip from '../components/chat/ToolCallChip.vue'
import CitationsList from '../components/chat/CitationsList.vue'
import { friendlyError } from '../lib/errors.js'
import { useSessionStore } from '../stores/session.js'
import { useToast } from '../composables/useToast.js'
import { costBus } from '../services/costBus.js'
import { getUploadStatus, uploadPdf } from '../services/uploadApi.js'
import { formatShortDateTime } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })

const router = useRouter()
const store = useSessionStore()

const streamEnabled = import.meta.env.VITE_CHAT_STREAM === 'true'

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
const canSend = computed(
  () => canEnd.value && !store.dailyCapReached && !store.costCapReached,
)

const { showError, showInfo } = useToast()
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
watch(
  () => store.costCapReached,
  (now) => {
    if (!now || !store.costCapInfo) return
    const when = formatShortDateTime(store.costCapInfo.resets_at) || 'midnight UTC'
    showError(
      `Daily cost limit reached ($${store.costCapInfo.used_usd} / $${store.costCapInfo.hard_cap_usd}). Resets at ${when}.`,
      { summary: 'Cost cap reached', life: 8000 },
    )
  },
)

// One soft-cap warning per mount of this view (i.e. per session entry).
const softCapShown = ref(false)
function onCostWarning() {
  if (softCapShown.value) return
  softCapShown.value = true
  showInfo(
    'You’re approaching the daily cost limit for this session.',
    { summary: 'Cost warning', life: 6000 },
  )
}
onMounted(() => costBus.addEventListener('cost-warning', onCostWarning))
onUnmounted(() => costBus.removeEventListener('cost-warning', onCostWarning))

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

const MAX_DRAFT_LEN = 2000
const COMPOSER_MAX_HEIGHT_PX = 220
const nearCharLimit = computed(() => draft.value.length >= MAX_DRAFT_LEN * 0.9)

function autoResize() {
  // Native textarea grows up to COMPOSER_MAX_HEIGHT_PX, then scrolls. Reset to
  // auto first so shrinking on backspace works (otherwise scrollHeight stays
  // high once the box has grown).
  const inner = composerEl.value
  if (!inner) return
  inner.style.height = 'auto'
  const next = Math.min(inner.scrollHeight, COMPOSER_MAX_HEIGHT_PX)
  inner.style.height = `${next}px`
}

watch(draft, () => nextTick(autoResize))

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
    // composerEl is now a native <textarea>, not a PrimeVue wrapper, so focus
    // it directly. Defensive fallback covers the (legacy) PrimeVue case to
    // avoid breaking if this template is reverted upstream.
    const el = composerEl.value
    const node =
      el && typeof el.focus === 'function'
        ? el
        : el?.$el?.querySelector?.('textarea')
    node?.focus()
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
    if (streamEnabled) {
      await store.sendMessageStreaming({ text })
    } else {
      await store.sendMessage({ text })
    }
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

.messages {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: clamp(10rem, 32vh, 18rem);
  max-height: calc(100vh - 22rem);
  overflow-y: auto;
  padding: 0.75rem 0.25rem 1rem 0;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.messages:has(.empty) {
  /* When the conversation is empty, let the empty-state anchor naturally
     near the top of the conversation area instead of being orphaned in a
     vertically-centered void. */
  justify-content: flex-start;
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
  gap: 0.625rem;
  padding: 1.75rem 1rem 1.25rem;
  margin: 0;
}

.empty-spark {
  color: var(--color-accent);
  margin-bottom: 0.125rem;
  filter: drop-shadow(0 2px 12px rgba(255, 107, 92, 0.35));
  animation: spark-breath 4.5s ease-in-out infinite;
}

@keyframes spark-breath {
  0%, 100% { transform: rotate(0deg) scale(1); opacity: 0.9; }
  50% { transform: rotate(18deg) scale(1.06); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .empty-spark { animation: none; }
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

.tool-call-row {
  display: inline-flex;
  margin: 0 0 0.4rem;
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

/* Composer — native textarea + icon buttons in a CSS grid. Replaced the
   previous PrimeVue Textarea + Button because Aura's tokens were bleeding
   through the wrapper and breaking the layout (white box overflowing the
   dark pill). Owning the markup gives us deterministic styling. */
.composer-wrap {
  position: sticky;
  bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  z-index: 2;
}

.composer {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: end;
  gap: 0.5rem;
  padding: 0.55rem 0.55rem 0.55rem 0.6rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lift);
  transition:
    border-color var(--motion-fast) ease,
    box-shadow var(--motion-base) ease,
    transform var(--motion-base) var(--motion-bounce);
}

.composer:focus-within {
  border-color: var(--color-accent);
  box-shadow:
    var(--shadow-lift),
    0 0 0 4px var(--color-accent-ring);
  transform: translateY(-1px);
}

.composer.is-disabled {
  opacity: 0.7;
}

.composer-input {
  grid-column: 2;
  align-self: stretch;
  width: 100%;
  min-height: 2.5rem;
  max-height: 220px;
  padding: 0.625rem 0.25rem;
  margin: 0;
  background: transparent;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: auto;

  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.5;
  color: var(--color-text);
  caret-color: var(--color-accent);

  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.composer-input::placeholder {
  color: var(--color-text-faint);
  opacity: 1;
}

.composer-input:disabled {
  cursor: not-allowed;
}

.composer-input::-webkit-scrollbar { width: 6px; }
.composer-input::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}

/* Attach + send share the round-icon vocabulary. Sizes intentionally
   identical so the composer reads as balanced book-ends around the input. */
.composer-attach,
.composer-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  font-size: 1rem;
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease,
    border-color var(--motion-fast) ease,
    transform var(--motion-fast) var(--motion-bounce),
    box-shadow var(--motion-fast) ease,
    opacity var(--motion-fast) ease;
}

.composer-attach {
  grid-column: 1;
  align-self: end;
  margin-bottom: 0.1rem;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.composer-attach:hover:not(:disabled),
.composer-attach:focus-visible {
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
  color: var(--color-accent);
  outline: none;
}

.composer-attach:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.composer-send {
  grid-column: 3;
  align-self: end;
  margin-bottom: 0.1rem;
  background: var(--color-accent);
  color: #FFFFFF;
  border: 0;
  box-shadow: var(--shadow-pop);
  font-weight: 600;
}

.composer-send:not(:disabled):hover,
.composer-send:not(:disabled):focus-visible {
  transform: translateY(-2px);
  outline: none;
}

.composer-send:not(:disabled):active {
  transform: translateY(3px);
  box-shadow: var(--shadow-pop-pressed);
}

.composer-send:disabled {
  background: var(--color-surface-soft);
  color: var(--color-text-faint);
  box-shadow: none;
  cursor: not-allowed;
}

/* Footer hint strip — keyboard cheatsheet left, character count right.
   Mono caption styling keeps it editorial without competing with the input. */
.composer-hints {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  user-select: none;
}

.composer-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.composer-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--color-surface-soft);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  line-height: 1;
}

.composer-hint-sep {
  color: var(--color-border-strong);
}

.composer-count {
  font-variant-numeric: tabular-nums;
  transition: color var(--motion-fast) ease;
}

.composer-hints.is-near-limit .composer-count {
  color: var(--signal-warning);
  font-weight: 600;
}

@media (max-width: 600px) {
  .composer-hints { display: none; }
  .composer-attach,
  .composer-send {
    width: 2.25rem;
    height: 2.25rem;
  }
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

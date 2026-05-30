<template>
  <section class="session">
    <div v-if="notFound" class="not-found" data-testid="session-not-found">
      <BackButton />
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
      <SessionHeader :topic="store.currentSession?.topic || ''" />

      <BackButton />

      <CapBanners />

      <SessionEndedBanner
        v-if="isEnded"
        :ended-at="store.currentSession.ended_at"
        :loading="resuming"
        @resume="resume"
      />

      <div ref="messagesEl" class="messages" :class="{ 'is-empty': !store.messages.length }" data-testid="session-messages">
        <ChatEmptyState
          v-if="!store.messages.length"
          :archived="isEnded"
          @quick-prompt="useQuickPrompt"
        />
        <MessageList
          v-if="store.messages.length || store.streamingMessage || awaitingResponse"
          :messages="store.messages"
          :streaming-message="store.streamingMessage"
          :awaiting="awaitingResponse"
        />
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

      <UploadStatus :upload="uploadStatus" />

      <Composer
        v-if="!isEnded"
        ref="composerRef"
        :model-value="draft"
        @update:model-value="draft = $event"
        :disabled="!canSend"
        :uploading="uploading"
        :sending="sending"
        :stream-state="store.streamState"
        :describedby="capDescribedby"
        @send="send"
        @stop="store.stopStream"
        @attach="onAttachFile"
      />

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
import CapBanners from '../components/chat/CapBanners.vue'
import ChatEmptyState from '../components/chat/EmptyState.vue'
import Composer from '../components/chat/Composer.vue'
import MessageList from '../components/chat/MessageList.vue'
import SessionHeader from '../components/chat/SessionHeader.vue'
import SessionEndedBanner from '../components/SessionEndedBanner.vue'
import UploadStatus from '../components/chat/UploadStatus.vue'
import { friendlyError } from '../lib/errors.js'
import { useSessionStore } from '../stores/session.js'
import { useToast } from '../composables/useToast.js'
import { costBus } from '../services/costBus.js'
import { MAX_UPLOAD_BYTES, getUploadStatus, uploadPdf } from '../services/uploadApi.js'
import { formatShortDateTime } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })

const router = useRouter()
const store = useSessionStore()

// Streaming (SSE) is the default chat path. Set VITE_CHAT_STREAM=false to fall
// back to the JSON POST /api/chat endpoint.
const streamEnabled = import.meta.env.VITE_CHAT_STREAM !== 'false'

const draft = ref('')
const lastSentText = ref('')
const summaryDialog = ref(false)
const summaryText = ref('')
const summaryKind = ref('summary')
const notFound = ref(false)
const resuming = ref(false)
const sending = ref(false)
const messagesEl = ref(null)
const composerRef = ref(null)
const uploading = ref(false)
const uploadStatus = ref(null)
const lastError = ref(null)

const isEnded = computed(() => Boolean(store.currentSession?.ended_at))
const canEnd = computed(() => Boolean(store.currentSession && !store.currentSession.ended_at))
const canSend = computed(() => canEnd.value && !store.dailyCapReached && !store.costCapReached)

// When the composer is disabled because a daily/cost cap was hit, point its
// aria-describedby at the matching cap banner so screen-reader users hear why
// input is blocked. null when not cap-disabled (renders no attribute).
const capDescribedby = computed(() => {
  const ids = []
  if (store.dailyCapReached) ids.push('cap-banner-daily')
  if (store.costCapReached) ids.push('cap-banner-cost')
  return ids.length ? ids.join(' ') : null
})

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

// App-shell lock: while in a session, the document itself must not scroll —
// only the .messages box does. A body class drives the route-scoped overflow
// lock and flex-height cascade (see <style>). Removed unconditionally on leave
// so other routes regain normal document scroll.
onMounted(() => document.body.classList.add('chat-locked'))
onUnmounted(() => document.body.classList.remove('chat-locked'))

// Show the "typing" placeholder when we've appended the user message but the
// tutor reply hasn't arrived yet. Driven by `sending` rather than `store.loading`
// so list-load spinners don't flicker the placeholder.
const awaitingResponse = computed(() => {
  if (!sending.value) return false
  const last = store.messages[store.messages.length - 1]
  return !last || last.role === 'user'
})

function scrollToBottom() {
  // App-shell: the .messages box is the sole scroller, so drive it directly.
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
  nextTick(() => composerRef.value?.focus())
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

// End is triggered from the sidebar row context menu (S2). When the store
// commits the End and the ended session matches this view's id, surface the
// closing summary modal here. Watching pendingSummary keeps the trigger
// location decoupled from the dialog owner.
watch(
  () => store.pendingSummary,
  (s) => {
    if (!s || s.sessionId !== props.id) return
    summaryKind.value = s.kind
    summaryText.value = s.text
    summaryDialog.value = true
    store.consumePendingSummary()
  },
)

async function onAttachFile(file) {
  // Client-side pre-check for instant feedback. The backend still enforces both
  // (PDF-only + 25 MB) and is authoritative; this just avoids a full upload that
  // would only fail with a generic rejection.
  if (file.type && file.type !== 'application/pdf') {
    uploadStatus.value = { kind: 'failed', text: 'Only PDF files can be attached.' }
    return
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    uploadStatus.value = {
      kind: 'failed',
      text: `${file.name} is too large (max ${maxMb} MB). Choose a smaller PDF.`,
    }
    return
  }
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
/* App-shell: while in a session the document is locked to the viewport and the
   .messages box is the only scroller. The body.chat-locked class (toggled on
   mount/unmount) drives the overflow lock and the flex-height cascade — every
   ancestor down to the scroller needs min-height: 0 so it can shrink instead of
   overflowing. Scoped to this route; other routes keep normal document scroll. */
:global(body.chat-locked) { overflow: hidden; }
:global(body.chat-locked #app) { height: 100vh; height: 100dvh; }
:global(body.chat-locked .page) { min-height: 0; }
:global(body.chat-locked .page-inner) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding-top: clamp(1rem, 3vw, 1.75rem);
  padding-bottom: 0;
}

.session {
  max-width: 56rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  flex: 1;
  min-height: 0;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
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
  /* Sole scroller in the app-shell. min-height: 0 lets it shrink within the
     flex column instead of forcing the page to overflow. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem 0.25rem;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.messages::-webkit-scrollbar { width: 8px; }
.messages::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.messages::-webkit-scrollbar-thumb:hover { background: var(--color-text-faint); }

.messages.is-empty {
  /* When the conversation is empty, let the empty-state anchor naturally
     near the top of the conversation area instead of being orphaned in a
     vertically-centered void. */
  justify-content: flex-start;
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
  background: var(--color-accent-strong);
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
  color: var(--color-accent-text);
  text-decoration: none;
}

.home-link:hover,
.home-link:focus-visible {
  color: var(--color-accent-hover);
  outline: none;
}
</style>

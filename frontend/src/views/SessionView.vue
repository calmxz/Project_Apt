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
      <BackButton />

      <SessionHeader :topic="headerTopic" :session-id="props.id" />

      <CapBanners />

      <SessionEndedBanner
        v-if="isEnded"
        :ended-at="store.currentSession.ended_at"
        :loading="resuming"
        :has-gaps="hasGaps"
        @resume="resume"
        @resume-gaps="resumeReviewGaps"
      />

      <GapPickerDialog
        v-model:visible="gapPickerOpen"
        :gaps="confirmedGaps"
        @select="onGapPicked"
      />

      <div
        ref="messagesEl"
        class="messages"
        :class="{ 'is-empty': !store.messages.length }"
        data-testid="session-messages"
      >
        <MessageListSkeleton v-if="store.detailLoading" />
        <template v-else>
          <button
            v-if="store.hasMoreMessages && store.messages.length"
            type="button"
            class="load-earlier"
            data-testid="load-earlier"
            :disabled="store.loadingEarlier"
            @click="onLoadEarlier"
          >
            <template v-if="store.loadingEarlier">Loading…</template>
            <template v-else-if="store.loadEarlierError"
              >Could not load earlier messages — retry</template
            >
            <template v-else>Load earlier messages</template>
          </button>
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
        </template>
      </div>

      <div class="sr-only" role="status" aria-live="polite" data-testid="stream-status">
        {{ streamAnnouncement }}
      </div>

      <p
        v-if="store.followupNotice"
        class="followup-notice"
        data-testid="followup-notice"
        role="status"
        aria-live="polite"
      >
        {{ store.followupNotice }}
      </p>

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
        <router-link
          v-if="store.duplicateReopen"
          :to="{ name: 'session', params: { id: store.duplicateReopen.sessionId } }"
          class="home-link"
          data-testid="go-to-active-session"
        >
          Go to active session
        </router-link>
      </div>

      <ReferenceStatusBanner ref="referenceBannerRef" :session-id="props.id" />

      <UploadStatus :upload="uploadStatus" />

      <CheckQuestion
        v-if="store.pendingCheck && !store.detailLoading"
        :check="store.pendingCheck"
        :busy="store.streamState !== 'idle'"
        @answer="onAnswerCheck"
        @skip="onSkipCheck"
        @next="store.nextCheck"
        @done="onDoneCheck"
      />

      <DiagnosticConsentCard
        v-if="showDiagnosticCard"
        :busy="store.streamState !== 'idle' || !canSend || diagLevelBusy"
        :error="diagError"
        @quiz="onDiagQuiz"
        @level="onDiagLevel"
        @dismiss="dismissDiag()"
      />

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
        :locked="store.checkLocked"
        @send="send"
        @stop="store.stopStream"
        @attach="onAttachFile"
        @skip="onSkipCheck"
      />

      <Dialog
        v-model:visible="summaryDialog"
        header="Nice work!"
        modal
        :closable="true"
        data-testid="session-summary-dialog"
        class="crux-dialog summary-dialog"
      >
        <p class="summary" :data-testid="`session-summary-${summaryKind}`">
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
import { useRoute, useRouter } from 'vue-router'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

import BackButton from '../components/BackButton.vue'
import CapBanners from '../components/chat/CapBanners.vue'
import ChatEmptyState from '../components/chat/EmptyState.vue'
import CheckQuestion from '../components/chat/CheckQuestion.vue'
import Composer from '../components/chat/Composer.vue'
import DiagnosticConsentCard from '../components/DiagnosticConsentCard.vue'
import GapPickerDialog from '../components/GapPickerDialog.vue'
import MessageList from '../components/chat/MessageList.vue'
import MessageListSkeleton from '../components/chat/MessageListSkeleton.vue'
import SessionHeader from '../components/chat/SessionHeader.vue'
import SessionEndedBanner from '../components/SessionEndedBanner.vue'
import ReferenceStatusBanner from '../components/chat/ReferenceStatusBanner.vue'
import UploadStatus from '../components/chat/UploadStatus.vue'
import { friendlyError, StreamAbortedError } from '../lib/errors.js'
import { useSessionStore } from '../stores/session.js'
import { useToast } from '../composables/useToast.js'
import { costBus } from '../services/costBus.js'
import { getSessionProfile, patchProfile } from '../services/profileApi.js'
import { getUploadStatus, uploadDocument, validateFile } from '../services/uploadApi.js'
import { formatShortDateTime } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const draft = ref('')
const lastSentText = ref('')
const summaryDialog = ref(false)
const summaryText = ref('')
const summaryKind = ref('summary')
const notFound = ref(false)
const resuming = ref(false)
const gapPickerOpen = ref(false)
const sending = ref(false)
const messagesEl = ref(null)
const composerRef = ref(null)
const uploading = ref(false)
const uploadStatus = ref(null)
// Same generation-counter idiom as ReferenceStatusBanner: /session/:id reuses
// this component instance across sidebar switches, so an in-flight upload poll
// from the previous session must not write uploadStatus/uploading after the id
// changes. Bumped by the props.id watcher; every write after an await checks it.
let uploadGen = 0
const lastError = ref(null)
const referenceBannerRef = ref(null)

// Diagnostic consent card (spec 2026-07-25-diagnostic-consent-design.md).
// diagProfile holds the latest GET /profile/:id payload ({ profile, etag });
// null means not loaded or load failed - the card simply does not render,
// the tutor's conversational offer is the fallback.
const diagProfile = ref(null)
const diagDismissed = ref(false)
const diagError = ref('')
// A conversational decline ("no thanks, just teach me") never writes a level,
// so knowledge_level stays null and the card would render for the rest of the
// session. Two completed tutor turns with the level still null are treated as
// an implicit decline. Dismissals (explicit or implicit) persist per session in
// sessionStorage so a reload does not resurrect the card.
let diagNullTurns = 0

function diagDismissKey(id) {
  return `crux:diag-dismissed:${id}`
}

function dismissDiag() {
  diagDismissed.value = true
  try {
    sessionStorage.setItem(diagDismissKey(props.id), '1')
  } catch {
    // storage unavailable (private mode/quota) - in-memory dismissal still holds
  }
}
// F5: guards onDiagLevel's async body against a rapid second click firing a
// second PATCH with the same (soon-to-be-stale) etag. Folded into the card's
// busy binding so the buttons visually disable too.
const diagLevelBusy = ref(false)

const showDiagnosticCard = computed(() =>
  Boolean(
    diagProfile.value &&
    diagProfile.value.profile?.knowledge_level == null &&
    !store.pendingCheck &&
    !diagDismissed.value &&
    !isEnded.value &&
    !resuming.value &&
    !notFound.value &&
    !store.detailLoading,
  ),
)

async function loadDiagProfile(id) {
  try {
    const data = await getSessionProfile(id)
    if (id !== props.id) return // stale response from a previous session
    diagProfile.value = data
  } catch {
    if (id === props.id) diagProfile.value = null
  }
}

// F-18: a live region over the token-streaming bubble spams SRs with every
// mutation. Announce discrete transitions instead. The store's stream state
// machine has intermediate members beyond idle/streaming (tool_running,
// stopping), so the edges we care about are idle -> non-idle (start) and
// non-idle -> idle (finish), not every individual hop.
const streamAnnouncement = ref('')
watch(
  () => store.streamState,
  (next, prev) => {
    if (prev === 'idle' && next !== 'idle') streamAnnouncement.value = 'Tutor is replying.'
    else if (prev !== 'idle' && next === 'idle') streamAnnouncement.value = 'Reply finished.'
  },
)

// F2: the agent may have conversationally recorded a declared level
// (update_topic_profile) during the turn -- that only becomes visible to us
// via a refetch. Once the tutor's turn finishes, refetch so the card hides
// itself and the cached etag stays fresh, instead of lingering with a stale
// null level until the next explicit reload.
watch(
  () => store.streamState,
  (next, prev) => {
    if (prev === 'idle' || next !== 'idle') return
    if (
      diagProfile.value &&
      diagProfile.value.profile?.knowledge_level == null &&
      !diagDismissed.value
    ) {
      diagNullTurns += 1
      if (diagNullTurns >= 2) {
        dismissDiag()
        return
      }
      loadDiagProfile(props.id)
    }
  },
)

// Use the same target-id discriminator as headerTopic so the ended-banner /
// composer / resume action agree with the optimistic header during a switch.
// While detail loads, store.currentSession still holds the PREVIOUS session, so
// reading ended_at directly would show a stale banner and misdirect resume() to
// the old session id. Falls back to not-ended until the target detail resolves.
const isEnded = computed(() =>
  store.currentSession?.id === props.id ? Boolean(store.currentSession.ended_at) : false,
)
// Gates the "Review my gaps" CTA — only meaningful once we're showing the
// ended banner for this session, so read confirmed_gaps off the same
// discriminator-checked currentSession rather than re-deriving it.
const hasGaps = computed(
  () => (store.currentSession?.topic_profile?.confirmed_gaps?.length ?? 0) > 0,
)
// Same discriminator-checked source as hasGaps, but the full list is needed to
// drive the picker (single gap skips it, >1 gap opens it).
const confirmedGaps = computed(() =>
  (store.currentSession?.topic_profile?.confirmed_gaps ?? []).map((g) => g?.name ?? g),
)
// Discriminator-gated (same as isEnded/headerTopic): during a switch,
// store.currentSession still holds the PREVIOUS session, so gating on raw
// currentSession would leave the composer enabled+pointed at the old session
// (currentSessionId lags props.id until the await resolves) — a send would
// land in the wrong session and then vanish when the target detail loads.
const canEnd = computed(
  () => store.currentSession?.id === props.id && !store.currentSession.ended_at,
)
const canSend = computed(() => canEnd.value && !store.dailyCapReached && !store.costCapReached)

// Optimistic header: while the detail fetch is in flight, store.currentSession
// still holds the PREVIOUS session (it is overwritten only after the await
// resolves), so paint the target session's topic from the already-known list
// row. View-local only — store.currentSession is never stubbed, which is what
// keeps this clear of the PR #72 switch-reload bug class.
const knownRow = computed(() => store.sessions.find((s) => s.id === props.id) || null)
const headerTopic = computed(() => {
  if (store.currentSession?.id === props.id) return store.currentSession.topic || ''
  return knownRow.value?.topic || ''
})

// When the composer is disabled because a daily/cost cap was hit, point its
// aria-describedby at the matching cap banner so screen-reader users hear why
// input is blocked. null when not cap-disabled (renders no attribute).
const capDescribedby = computed(() => {
  const ids = []
  if (store.dailyCapReached) ids.push('cap-banner-daily')
  if (store.costCapReached) ids.push('cap-banner-cost')
  return ids.length ? ids.join(' ') : null
})

const { showError, showWarn } = useToast()
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

// One warning per level, per mount of this view (i.e. per session entry).
// Soft and urgent are tracked separately so an urgent warning can still
// surface even if a soft one already showed earlier in this mount (urgent
// escalates the signal; it must never be silently swallowed by a prior soft
// warning), while neither level repeats.
const softCapShown = ref(false)
const urgentCapShown = ref(false)
function resolveCostWarningLevel(detail) {
  let level = detail?.level
  if (!level && typeof detail?.header === 'string') {
    const match = detail.header.match(/level=(\w+)/)
    level = match ? match[1] : null
  }
  return level === 'urgent' ? 'urgent' : 'soft'
}
function onCostWarning(event) {
  const level = resolveCostWarningLevel(event?.detail)
  if (level === 'urgent') {
    if (urgentCapShown.value) return
    urgentCapShown.value = true
    showError('You are very close to today’s cost limit.', {
      summary: 'Cost limit near',
      life: 8000,
    })
    return
  }
  if (softCapShown.value) return
  softCapShown.value = true
  showWarn('You’re approaching the daily cost limit for this session.', {
    summary: 'Cost warning',
    life: 6000,
  })
}
onMounted(() => costBus.addEventListener('cost-warning', onCostWarning))
onUnmounted(() => costBus.removeEventListener('cost-warning', onCostWarning))

// App-shell lock: while in a session, the document itself must not scroll —
// only the .messages box does. A body class drives the route-scoped overflow
// lock and flex-height cascade (see <style>). Removed unconditionally on leave
// so other routes regain normal document scroll.
onMounted(() => document.body.classList.add('chat-locked'))
onUnmounted(() => document.body.classList.remove('chat-locked'))

// F-01: leaving the session view must not leave a stream running (and
// billing) in the background, nor let it deliver into a later session.
onUnmounted(() => store.abandonStream())

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

// True from the moment a "load earlier" click starts until its scroll-offset
// restore lands. The autoscroll watcher below fires when store.messages.length
// changes (prepend included) - without this guard it would yank the view back
// to the bottom right after older messages are spliced in. store.loadingEarlier
// is already false by the time the watcher flushes (it's cleared before the
// awaited nextTick below resolves), so it can't do this job - this local flag
// is the whole point.
const prepending = ref(false)

async function onLoadEarlier() {
  const el = messagesEl.value
  const prevHeight = el ? el.scrollHeight : 0
  const prevTop = el ? el.scrollTop : 0
  prepending.value = true
  try {
    await store.loadEarlierMessages()
    await nextTick()
    if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
  } finally {
    prepending.value = false
  }
}

watch([() => store.messages.length, awaitingResponse], () => {
  if (prepending.value) return
  scrollToBottom()
})

async function loadCurrent(id) {
  // Reset per-load so navigating away from a 404 session clears the state.
  notFound.value = false
  // Drop any prior session's send-error so it can't render (with a wrong-session
  // Retry) over the newly-navigated session. Mirrors store.error clearing on
  // loadSession entry. loadCurrent only runs on mount + id-change, so a same-
  // session send-error stays retryable.
  lastError.value = null
  diagProfile.value = null
  diagNullTurns = 0
  try {
    diagDismissed.value = sessionStorage.getItem(diagDismissKey(id)) === '1'
  } catch {
    diagDismissed.value = false
  }
  diagError.value = ''
  diagLevelBusy.value = false
  loadDiagProfile(id) // deliberately not awaited: card is best-effort
  const startedAt = import.meta.env.DEV ? performance.now() : 0
  try {
    await store.loadSession(id)
    if (import.meta.env.DEV) {
      await nextTick()
      // Dev-only WS3 gate measurement: navigate -> detail painted. This number
      // decides whether the retention tail (warm prefetch + SWR cache) is worth
      // building (see Task 5). Remove once that decision is recorded.
      console.debug(
        `[perf] session ${id} detail painted in ${Math.round(performance.now() - startedAt)}ms`,
      )
    }
  } catch (e) {
    // Superseded load: a newer navigation already changed props.id, so a late
    // 404 from the session we left must not flash its not-found over the one now
    // on screen. Same discriminator the success-path computeds use (id===props.id).
    if (id !== props.id) return
    if (e?.status === 404) {
      notFound.value = true
      store.setError(null)
    }
  }
  if (!isEnded.value && !notFound.value) focusComposer()
  // Covers fresh navigation (new id, e.g. from ProfileView's "Review gaps"
  // button, or the level-at-start picker's "Quiz me" chip) where the query
  // is already present before the session loads. handleQuizQuery runs first
  // so its review_gap precedence guard reads the query before
  // handleReviewGapQuery strips it.
  if (!notFound.value) {
    await handleQuizQuery()
    await handleReviewGapQuery()
  }
}

onMounted(() => {
  loadCurrent(props.id)
  restoreStashedDraft(props.id)
})

// Sidebar session->session clicks reuse this route component (same /session/:id
// route), so onMounted does not re-fire. Re-load when the id prop changes;
// otherwise the body keeps showing the previous session until a full refresh.
watch(
  () => props.id,
  (id) => {
    if (!id) return
    // Invalidate any in-flight upload/poll from the previous session and clear
    // its banner/lock so the new session never shows or inherits them.
    uploadGen += 1
    uploading.value = false
    uploadStatus.value = null
    loadCurrent(id)
    restoreStashedDraft(id)
  },
)

// Covers same-id in-place navigation (e.g. ProfileView -> back to the session
// already open) where loadCurrent does not re-run. Not immediate: the initial
// value is handled by loadCurrent above, which waits for the session to load
// first -- an immediate watch here would fire during setup, before
// store.currentSession is populated, and either send into the wrong session
// or throw "no active session".
watch(
  () => route.query.review_gap,
  (gap) => {
    if (!gap) return
    if (store.currentSession?.id !== props.id) return
    handleReviewGapQuery()
  },
)

// Twin of the review_gap watcher above, for the smart-start quiz seed.
watch(
  () => route.query.quiz,
  (quiz) => {
    if (!quiz) return
    if (store.currentSession?.id !== props.id) return
    handleQuizQuery()
  },
)

function focusComposer() {
  nextTick(() => composerRef.value?.focus())
}

function useQuickPrompt(text) {
  draft.value = text
  focusComposer()
}

const canRetry = computed(() => Boolean(lastSentText.value) && !sending.value && !isEnded.value)

async function send() {
  const text = draft.value
  if (!text.trim()) return
  draft.value = ''
  lastSentText.value = text
  lastError.value = null
  sending.value = true
  try {
    await store.sendMessageStreaming({ text })
    lastSentText.value = ''
  } catch (e) {
    if (e instanceof StreamAbortedError) {
      // The store already surfaced the state (ended banner / login redirect),
      // so a generic error chip on top of it would be noise. Just give the
      // text back so nothing the user typed is lost.
      if (e.reason === 'auth_expired') {
        // E-05: this component is about to unmount via the login redirect, so
        // in-memory draft restore is not enough - park it where the post-login
        // remount can find it.
        try {
          sessionStorage.setItem(`crux:draft:${props.id}`, text)
        } catch {
          // storage unavailable (private mode/quota) - the in-memory restore
          // below is still the best we can do
        }
      }
      draft.value = text
    } else {
      draft.value = text
      lastError.value = e
    }
  } finally {
    sending.value = false
  }
}

async function retryLastMessage() {
  // E-14: the composer wins. After a failed send the draft is restored, and the
  // user may have edited it before hitting Retry - resending lastSentText would
  // silently discard that edit. lastSentText is only the fallback for the case
  // where the composer was cleared.
  if (!draft.value.trim() && lastSentText.value) draft.value = lastSentText.value
  if (!draft.value.trim()) return
  await send()
}

// E-05: a draft stashed by send() just before the auth redirect survives the
// login round-trip in sessionStorage; restore it exactly once.
function restoreStashedDraft(id) {
  const key = `crux:draft:${id}`
  try {
    const stashed = sessionStorage.getItem(key)
    if (stashed !== null) {
      draft.value = stashed
      sessionStorage.removeItem(key)
    }
  } catch {
    // storage unavailable (private mode/quota) - nothing to restore
  }
}

async function onDiagQuiz() {
  if (!canSend.value) return
  const id = props.id
  diagError.value = ''
  try {
    await store.sendMessageStreaming({ text: 'Quiz me to gauge my level' })
  } catch {
    if (id !== props.id) return // stale response from a previous session
    // F6: surface on the card, like the level path, instead of the generic
    // session error banner -- a card failure should read as a card failure.
    diagError.value = 'Could not start the quiz. Try again.'
  }
}

// The card's PATCH writes the level out-of-band of the conversation, so the
// transcript would otherwise end with the tutor's own unanswered offer -- which
// makes the model re-ask it next turn. Close the loop with a normal user
// message. Best-effort: the level is already saved deterministically, so a
// send failure is not surfaced on the card.
async function sendLevelDeclaration(level) {
  if (!canSend.value) return
  try {
    await store.sendMessageStreaming({ text: `I'd say my level is ${level}.` })
  } catch {
    /* level already persisted; DIAGNOSTIC flips OFF regardless */
  }
}

async function onDiagLevel(level) {
  // F5: a rapid second click before the first PATCH resolves must not fire a
  // second PATCH with the same (soon-to-be-stale) etag.
  if (diagLevelBusy.value) return
  // Same reuse-across-switches hazard as uploadGen (see comment above): this
  // component instance survives a session switch, so a PATCH started before
  // the switch must not write the new session's diagProfile/diagError when it
  // resolves late.
  const id = props.id
  const etag = diagProfile.value?.etag
  if (!etag) return
  diagLevelBusy.value = true
  diagError.value = ''
  try {
    const res = await patchProfile(id, { knowledge_level: level }, etag)
    if (id !== props.id) return // stale response from a previous session
    diagProfile.value = { profile: res.profile, etag: res.etag }
    await sendLevelDeclaration(level)
  } catch (e) {
    if (e?.status === 412) {
      // Concurrent write (e.g. a quiz just graded). Refetch; if the level is
      // now set the card hides itself via showDiagnosticCard. loadDiagProfile
      // has its own stale-response guard, so this is safe even if the
      // session has since switched.
      await loadDiagProfile(id)
      if (id !== props.id) return // stale response from a previous session
      if (diagProfile.value == null) {
        // The refetch itself failed (loadDiagProfile sets it to null on
        // error) -- distinct from "refetch succeeded, level still null".
        diagError.value = 'Could not save your level. Try again.'
      } else if (diagProfile.value.profile?.knowledge_level == null) {
        // Refetch shows the level is STILL unset: the 412 was a stale-etag
        // false alarm, not a real conflicting write. Retry once with the
        // fresh etag so the original click is not silently swallowed.
        const freshEtag = diagProfile.value.etag
        try {
          const retryRes = await patchProfile(id, { knowledge_level: level }, freshEtag)
          if (id !== props.id) return // stale response from a previous session
          diagProfile.value = { profile: retryRes.profile, etag: retryRes.etag }
          await sendLevelDeclaration(level)
        } catch {
          if (id !== props.id) return // stale response from a previous session
          diagError.value = 'Could not save your level. Try again.'
        }
      }
    } else {
      if (id !== props.id) return // stale response from a previous session
      diagError.value = 'Could not save your level. Try again.'
    }
  } finally {
    if (id === props.id) diagLevelBusy.value = false
  }
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
  { immediate: true },
)

async function onAttachFile(file) {
  // Client-side pre-check for instant feedback; backend re-validates (type + 25 MB).
  const v = validateFile(file)
  if (!v.ok) {
    uploadStatus.value = { kind: 'failed', text: v.reason }
    return
  }
  uploading.value = true
  uploadStatus.value = { kind: 'pending', text: `Uploading ${file.name}...` }
  const gen = uploadGen
  try {
    const resp = await uploadDocument({ sessionId: props.id, file })
    if (gen !== uploadGen) return
    referenceBannerRef.value?.refresh?.()
    await pollUploadStatus(resp.document_id, file.name, gen)
    if (gen !== uploadGen) return
    referenceBannerRef.value?.refresh?.()
  } catch (e) {
    if (gen !== uploadGen) return
    // I-09: the 415 (and friends) carry an actionable server message -
    // prefer it over the generic friendlyError copy.
    const serverMsg = e?.body?.detail?.message
    uploadStatus.value = {
      kind: 'failed',
      text: `Upload failed: ${serverMsg || friendlyError(e)}`,
    }
  } finally {
    // The watcher already reset uploading for the new session; a stale finally
    // must not clobber a newer upload's uploading=true either.
    if (gen === uploadGen) uploading.value = false
  }
}

async function pollUploadStatus(documentId, filename, gen) {
  for (let i = 0; i < 90; i += 1) {
    let s
    try {
      s = await getUploadStatus(documentId)
    } catch (e) {
      if (gen !== uploadGen) return
      uploadStatus.value = {
        kind: 'failed',
        text: `Upload status unavailable: ${friendlyError(e)}`,
      }
      return
    }
    if (gen !== uploadGen) return
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
    if (gen !== uploadGen) return
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

async function resumeReviewGaps() {
  if (!store.currentSession) return
  if (confirmedGaps.value.length > 1) {
    gapPickerOpen.value = true
    return
  }
  await sendReviewSeed(confirmedGaps.value[0])
}

async function onGapPicked(gap) {
  await sendReviewSeed(gap)
}

async function sendReviewSeed(gap) {
  // Covers the query-driven path (handleReviewGapQuery), which is only
  // gated on !notFound in loadCurrent -- a non-404 loadSession failure
  // leaves store.currentSession null or stale relative to props.id. The
  // button path (resumeReviewGaps) already guards on !store.currentSession
  // before calling in, but this covers both null and stale defensively.
  if (!store.currentSession || store.currentSession.id !== props.id) return
  resuming.value = true
  try {
    if (isEnded.value) await store.reopenSession(store.currentSession.id)
    await store.sendMessageStreaming({
      text: `Review my gap: ${gap}`,
      reviewGaps: true,
      reviewGap: gap,
    })
  } catch {
    // store.error already populated
  } finally {
    resuming.value = false
  }
}

async function handleReviewGapQuery() {
  const gap = route.query.review_gap
  if (!gap) return
  router.replace({ query: { ...route.query, review_gap: undefined } })
  await sendReviewSeed(String(gap))
}

// Smart-start diagnostic quiz seed (?quiz=1, e.g. from the level-at-start
// picker's "Quiz me" chip). Mirrors handleReviewGapQuery/sendReviewSeed
// above. review_gap takes precedence when both params are present -- checked
// here (not after handleReviewGapQuery runs) because router.replace()'s
// query mutation is not guaranteed to be visible synchronously by the time
// handleReviewGapQuery's await resolves, so this guard must read
// route.query.review_gap before handleReviewGapQuery has a chance to strip
// it. Call sites therefore invoke handleQuizQuery() before
// handleReviewGapQuery().
async function handleQuizQuery() {
  if (!route.query.quiz) return
  // Read review_gap precedence before stripping quiz -- see comment above --
  // but always strip quiz regardless of the outcome. Otherwise a stale
  // ?quiz=1 that lost to review_gap on this render survives in the URL and
  // fires unprompted on a later remount/reload once review_gap is gone.
  const yieldToReviewGap = !!route.query.review_gap
  router.replace({ query: { ...route.query, quiz: undefined } })
  if (yieldToReviewGap) return
  if (!store.currentSession || store.currentSession.id !== props.id) return
  try {
    await store.sendMessageStreaming({
      text: 'Quiz me so you can pitch this at the right level.',
      diagnosticAccepted: true,
    })
  } catch {
    // store.error already populated; consent card remains as fallback
  }
}

async function onAnswerCheck(index) {
  try {
    await store.answerCheck(index)
  } catch (e) {
    lastError.value = e
  }
}

async function onSkipCheck() {
  try {
    await store.skipCheck()
  } catch (e) {
    lastError.value = e
  }
}

async function onDoneCheck() {
  try {
    await store.completeCheck()
    // A graded diagnostic sets knowledge_level server-side; refetch so the
    // card stays gone (showDiagnosticCard) instead of reappearing stale.
    await loadDiagProfile(props.id)
  } catch (e) {
    lastError.value = e
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
:global(body.chat-locked) {
  overflow: hidden;
}
:global(body.chat-locked #app) {
  height: 100vh;
  height: 100dvh;
}
:global(body.chat-locked .page) {
  min-height: 0;
}
:global(body.chat-locked .page-inner) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding-top: clamp(1rem, 3vw, 1.75rem);
  padding-bottom: 0;
}

.session {
  width: 100%;
  max-width: 64rem;
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
  /* Reserve the scrollbar gutter whether or not the chat overflows, so the
     message column is the same fixed width in every session. Without this, a
     scrolling session loses ~10px to the scrollbar that a short one keeps. */
  scrollbar-gutter: stable;
  padding: 0.5rem 0.25rem;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.messages::-webkit-scrollbar {
  width: 8px;
}
.messages::-webkit-scrollbar-button {
  display: none;
  height: 0;
  width: 0;
}
.messages::-webkit-scrollbar-track {
  background: transparent;
}
.messages::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.messages::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-faint);
}

.load-earlier {
  align-self: stretch;
  width: 100%;
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: 0.4rem 0.75rem;
  font-family: var(--font-sans);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--motion-fast) ease;
}

.load-earlier:hover:not(:disabled) {
  background: var(--color-surface-soft);
}

.load-earlier:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.load-earlier:disabled {
  cursor: default;
  opacity: 0.7;
}

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
  background: var(--color-error-text);
  color: #ffffff;
  border: 0;
  border-radius: var(--radius-pill);
  padding: 0.4rem 0.875rem;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition:
    filter var(--motion-fast) ease,
    transform var(--motion-fast) var(--motion-bounce);
}

.error-retry:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.error-retry:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.error {
  color: var(--color-error-text);
  margin: 0;
  font-size: var(--fs-caption);
}

.followup-notice {
  margin: 0;
  padding: 0.5rem 0.875rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
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

.home-link:hover {
  color: var(--color-accent-hover);
}

.home-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

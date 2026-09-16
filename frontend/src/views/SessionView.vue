<template>
  <section class="session" :class="{ 'is-sheet': !notFound, 'panel-collapsed': panelCollapsed }">
    <div v-if="notFound" class="not-found" data-testid="session-not-found">
      <BackButton />
      <span class="folio" data-tabular>404</span>
      <h1 class="topic">Session not found</h1>
      <p class="not-found-sub">
        The session id <code>{{ id }}</code> doesn't exist or was deleted.
      </p>
      <router-link to="/" class="home-link" data-testid="session-not-found-home">
        <svg
          viewBox="0 0 20 20"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M16 10 L4 10 M9 4.5 L4 10 L9 15.5" />
        </svg>
        Back to sessions
      </router-link>
    </div>

    <template v-else>
      <div class="sheet-header">
        <SessionHeader
          :topic="headerTopic"
          :session-id="props.id"
          :started-at="startedAt"
          :level="profileLevel"
        />
      </div>

      <!-- Notes before cue in the DOM so the reading order is thread first;
           the panel is placed in column 2 by the grid. -->
      <div class="sheet-notes">
        <div
          ref="messagesEl"
          class="messages"
          :class="{ 'is-empty': !store.messages.length }"
          data-testid="session-messages"
        >
          <div class="notes-measure">
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
                :landed="cuesLanded"
              />

              <!-- R2: under 900px the check card scrolls with the transcript.
                   Pinned in the foot it took a fixed ~420px out of a 844px
                   viewport and starved .messages down to ~190px (0px with the
                   cue expanded). The foot copy below is the >=900px form; the
                   two are v-if/v-else on isNarrow, so exactly one instance of
                   CheckQuestion exists at any width and an open batch can
                   never double-render. -->
              <CheckQuestion
                v-if="isNarrow && store.pendingCheck"
                class="check-inline"
                :check="store.pendingCheck"
                :busy="store.streamState !== 'idle'"
                @answer="onAnswerCheck"
                @skip="onSkipCheck"
                @next="store.nextCheck"
                @done="onDoneCheck"
              />
            </template>
          </div>
        </div>

        <div class="notes-foot">
          <div class="notes-measure">
            <CheckQuestion
              v-if="!isNarrow && store.pendingCheck && !store.detailLoading"
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

            <!-- One status slot: persistent state (caps, send error) stays
                 mounted because the composer's aria-describedby points at it;
                 the transient captions below it land one at a time. -->
            <div class="status-slot">
              <CapBanners />

              <div
                v-if="store.error || lastError"
                class="status-line is-alert"
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

              <UploadStatus v-if="topCaption === 'upload'" :upload="uploadStatus" />

              <p
                v-if="topCaption === 'followup'"
                class="status-line followup-notice"
                data-testid="followup-notice"
                role="status"
                aria-live="polite"
              >
                {{ store.followupNotice }}
              </p>
            </div>

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

            <SessionEndedBanner
              v-if="isEnded"
              :ended-at="store.currentSession.ended_at"
              :summary="endedSummary"
              :loading="resuming"
              :has-gaps="hasGaps"
              @resume="resume"
              @resume-gaps="resumeReviewGaps"
            />
          </div>
        </div>
      </div>

      <div class="sheet-cue">
        <CueColumn
          :profile="liveProfile"
          :session-id="props.id"
          :testing-gap="testingGap"
          @landed="onCuesLanded"
        />
      </div>

      <div class="sr-only" role="status" aria-live="polite" data-testid="stream-status">
        {{ streamAnnouncement }}
      </div>

      <GapPickerDialog
        v-model:visible="gapPickerOpen"
        :gaps="confirmedGaps"
        @select="onGapPicked"
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
import CueColumn from '../components/chat/CueColumn.vue'
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
import { usePanel } from '../composables/usePanel.js'
import { useToast } from '../composables/useToast.js'
import { costBus } from '../services/costBus.js'
import { getSessionProfile, patchProfile } from '../services/profileApi.js'
import { getUploadStatus, uploadDocument, validateFile } from '../services/uploadApi.js'
import { formatShortDateTime } from '../utils/formatDate.js'
import { stripAutoPrefix } from '../utils/sessionCard.js'
import { costCapToastMessage } from '../lib/capToast.js'

const props = defineProps({ id: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const store = useSessionStore()
// Drives the panel column width only (see --panel-col in <style>); CueColumn
// owns its own collapsed rendering and the toggle button.
const { collapsed: panelCollapsed } = usePanel()

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
// The same refetch is what keeps the cue column live: the store only writes
// topic_profile on loadSession, so a turn that recorded a gap, a mastered
// concept or a level would otherwise never reach the cues. Runs every turn,
// not only while the level is unset; the implicit-decline accounting below
// still reads the pre-refetch copy, exactly as before.
watch(
  () => store.streamState,
  (next, prev) => {
    if (prev === 'idle' || next !== 'idle') return
    const stillUnset =
      diagProfile.value &&
      diagProfile.value.profile?.knowledge_level == null &&
      !diagDismissed.value
    loadDiagProfile(props.id)
    if (!stillUnset) return
    diagNullTurns += 1
    if (diagNullTurns >= 2) dismissDiag()
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
// The one profile the frontend holds. The store's copy is only written on
// loadSession, so the per-turn GET /profile/:id refetch (diagProfile) is the
// fresher of the two and wins when present; both are already discriminated on
// props.id, so a switch never paints the previous session's cues.
const liveProfile = computed(() => {
  if (diagProfile.value?.profile) return diagProfile.value.profile
  return store.currentSession?.id === props.id ? (store.currentSession.topic_profile ?? null) : null
})
const profileLevel = computed(() => liveProfile.value?.knowledge_level || '')
const startedAt = computed(() =>
  store.currentSession?.id === props.id ? store.currentSession.created_at || '' : '',
)
const endedSummary = computed(() => stripAutoPrefix(liveProfile.value?.last_session_summary))
// While a check batch is open, the cue it tests carries the red underline.
const testingGap = computed(() => store.pendingCheck?.gap || '')
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

// Cue-lands: CueColumn diffs the live profile and tells us when new cues were
// written; the gutter of the latest tutor turn then carries the blue tick
// until the learner writes again.
const cuesLanded = ref(false)
function onCuesLanded() {
  cuesLanded.value = true
}

// One caption slot, one caption at a time: an upload report outranks a
// follow-up notice (it is the newer, more specific event).
const topCaption = computed(() => {
  if (uploadStatus.value) return 'upload'
  if (store.followupNotice) return 'followup'
  return null
})

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
    const { message, summary } = costCapToastMessage(store.costCapInfo, when)
    showError(message, { summary, life: 8000 })
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

// R2: the check card's placement is width-dependent (see the template comment).
// Driven by matchMedia rather than a CSS-only swap because the card has to move
// between two different containers — the .messages scroller and the foot — which
// CSS cannot do. Kept in sync with the 899px breakpoint in <style> below.
const NARROW_QUERY = '(max-width: 899px)'
const isNarrow = ref(false)
let narrowMql = null
function onNarrowChange(e) {
  isNarrow.value = e.matches
}
onMounted(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  narrowMql = window.matchMedia(NARROW_QUERY)
  isNarrow.value = narrowMql.matches
  narrowMql.addEventListener?.('change', onNarrowChange)
})
onUnmounted(() => {
  narrowMql?.removeEventListener?.('change', onNarrowChange)
  narrowMql = null
})

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

// R2: at narrow widths the card lives at the end of the scroller, so a newly
// opened batch would otherwise land below the fold. Shallow watch — the store
// assigns a fresh object per batch, so this fires once per batch, not per
// answered item.
watch(
  () => store.pendingCheck,
  (now) => {
    if (now && isNarrow.value) scrollToBottom()
  },
)

async function loadCurrent(id) {
  // Reset per-load so navigating away from a 404 session clears the state.
  notFound.value = false
  // Drop any prior session's send-error so it can't render (with a wrong-session
  // Retry) over the newly-navigated session. Mirrors store.error clearing on
  // loadSession entry. loadCurrent only runs on mount + id-change, so a same-
  // session send-error stays retryable.
  lastError.value = null
  cuesLanded.value = false
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
  const startedAtMs = import.meta.env.DEV ? performance.now() : 0
  try {
    await store.loadSession(id)
    if (import.meta.env.DEV) {
      await nextTick()
      // Dev-only WS3 gate measurement: navigate -> detail painted. This number
      // decides whether the retention tail (warm prefetch + SWR cache) is worth
      // building (see Task 5). Remove once that decision is recorded.
      console.debug(
        `[perf] session ${id} detail painted in ${Math.round(performance.now() - startedAtMs)}ms`,
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
  // The learner is writing again: the previous turn's landed tick is spent.
  cuesLanded.value = false
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
/* The sheet owns its own edges: no page padding, no measure cap. */
:global(body.chat-locked .page-inner) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0;
}

/* The desk: thread on the left, profile panel on the right, one header across.
   --panel-col is the panel's width; the collapsed value is the vertical tab
   strip (CueColumn renders it, usePanel owns the state). */
.session.is-sheet {
  --panel-col: 17rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--panel-col);
  grid-template-rows: auto minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  width: 100%;
}

.session.is-sheet.panel-collapsed {
  --panel-col: 2.75rem;
}

.sheet-header {
  grid-column: 1 / -1;
  grid-row: 1;
  min-width: 0;
}

.sheet-cue {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  min-height: 0;
  min-width: 0;
}

.sheet-notes {
  grid-column: 1;
  grid-row: 2;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  min-width: 0;
}

.messages {
  /* Sole scroller in the app-shell. min-height: 0 lets it shrink within the
     grid row instead of forcing the page to overflow. The cards are laid on the
     desk: no ruled ground, the ground is what the turns sit on. */
  /* position: relative makes the scroller the containing block for everything
     inside it. Without it an absolutely positioned descendant with no offsets
     (the check card's sr-only live region) resolves against the page, escapes
     this box's overflow entirely, and is laid out at its static position deep
     in the unscrolled transcript -- which grew document.scrollHeight to 1132px
     on a 844px viewport and broke the "composer at the foot" promise. */
  position: relative;
  min-height: 0;
  overflow-y: auto;
  background: var(--desk);
  padding: 1rem clamp(1rem, 3vw, 2rem);
  scrollbar-width: thin;
  scrollbar-color: var(--rule-strong) transparent;
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
  background: var(--rule-strong);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* The measure: a 72ch text column plus the card's own padding, centered in the
   notes column. The foot uses the same rule so the composer card stays under
   the thread. */
.notes-measure {
  width: 100%;
  max-width: calc(72ch + 2rem);
  margin: 0 auto;
}

/* No top rule: the composer is a card on the desk, not a footer band. */
.notes-foot {
  padding: 0 clamp(1rem, 3vw, 2rem) 1rem;
  min-width: 0;
}

.notes-foot .notes-measure {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.75rem;
}

/* The slot is a grouping wrapper only: its children join the foot's own
   column so an empty slot costs no vertical space. */
.status-slot {
  display: contents;
}

.load-earlier {
  display: block;
  width: 100%;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  /* 27px + the 1px rule = one pitch, so the turns below still sit on the rules. */
  line-height: calc(var(--line-pitch) - 1px);
  color: var(--ink-learner);
  cursor: pointer;
  text-align: left;
}

.load-earlier:hover:not(:disabled) {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.load-earlier:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.load-earlier:disabled {
  cursor: default;
  color: var(--pencil);
}

/* Status captions: one line each, ink on paper inside a full 1px rule. */
.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
  margin: 0;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
  animation: status-land var(--motion-ink) cubic-bezier(0.16, 1, 0.3, 1) both;
}

.status-line.is-alert {
  border-color: var(--ink-marker);
}

@keyframes status-land {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}

.error-message {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
}

.error-retry {
  flex: 0 0 auto;
  background: transparent;
  color: var(--ink-learner);
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.error-retry:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.followup-notice {
  color: var(--pencil);
}

/* End-session summary dialog */
.summary {
  white-space: pre-wrap;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
  padding: 0.5rem 0;
}

/* Not-found */
.not-found {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: var(--line-pitch) clamp(1rem, 4vw, 2.5rem);
  max-width: 40rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.topic {
  font-family: var(--font-display);
  font-size: var(--fs-display);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
  margin: 0;
  overflow-wrap: anywhere;
}

.not-found-sub {
  margin: 0;
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.not-found code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  padding: 0.125rem 0.4rem;
  background: var(--color-surface-soft);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
}

.home-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  color: var(--ink-learner);
  text-decoration: none;
}

.home-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.home-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* Under 900px the profile panel becomes a strip under the header: one column,
   so --panel-col is unused at this width. Kept in sync with the NARROW_QUERY
   matchMedia switch in <script> -- the check card has to move between two
   different containers, which CSS alone cannot do. */
@media (max-width: 899px) {
  .session.is-sheet {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    /* clip, never hidden: hidden would make the grid a scroll container and
       change what the sticky strip and foot stick to. clip swallows the
       sheet's dim overlay (which runs a viewport's worth past the strip) and
       backstops anything else that tries to grow the page past the fold. */
    overflow: clip;
  }

  /* R2: no scroller and no 50vh cap here — the expanded profile is bounded by
     .cue-body's own 40vh cap in CueColumn, so the strip can never grow far
     enough to push the notes column (and the composer with it) off-screen. */
  .sheet-cue {
    grid-column: 1;
    grid-row: 2;
    display: block;
    min-height: 0;
  }

  .sheet-notes {
    grid-column: 1;
    grid-row: 3;
  }

  /* R2: the foot now carries only the status slot and the composer, so it is
     short enough to stay in view. Sticky pins it to the bottom of the notes
     column as a backstop if a status caption ever makes the column overflow. */
  .notes-foot {
    position: sticky;
    bottom: 0;
    background: var(--desk);
  }

  /* The inline card keeps the same spacing as the cards above it. */
  .check-inline {
    margin-bottom: 0.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-line {
    animation: none;
  }
}
</style>

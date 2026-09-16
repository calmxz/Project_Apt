<template>
  <div class="profile-tab" data-testid="agg-profile">
    <section class="sec" data-testid="profile-feedback">
      <h2 class="sec-title">Feedback style</h2>
      <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
      <div class="btn-fill-row">
        <button
          type="button"
          class="btn-fill"
          :class="{ 'btn-fill--busy': savingFeedback }"
          data-testid="profile-feedback-save"
          :disabled="!feedbackDirty || savingFeedback"
          @click="saveFeedback"
        >
          Save feedback style
        </button>
        <span
          v-if="feedbackSaved"
          class="saved-flash"
          role="status"
          data-testid="profile-feedback-saved"
        >
          <svg
            class="tick"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 6.5 L4.8 9.2 L10 3.2" />
          </svg>
          Saved.
        </span>
      </div>
    </section>

    <div v-if="loading" class="skel" data-testid="agg-loading" aria-hidden="true">
      <span class="skel-block" />
    </div>
    <span v-if="loading" class="sr-only" role="status">Loading</span>
    <p v-else-if="error" class="error" data-testid="agg-error">{{ error }}</p>

    <template v-else>
      <section class="sec" data-testid="profile-summary">
        <h2 class="sec-title">Topics</h2>
        <EmptyState
          v-if="topics.length === 0"
          data-testid="agg-empty"
          tone="celebrate"
          headline="No sessions yet"
          subtext="Start one — your profile builds itself as you go."
        >
          <template #cta>
            <router-link to="/new" class="link">Start your first session</router-link>
          </template>
        </EmptyState>
        <template v-else>
          <p class="lede" data-testid="profile-summary-line">{{ summaryLine }}</p>
          <router-link to="/sessions" class="link link--block" data-testid="profile-see-all">
            See all topics
          </router-link>
        </template>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'

import EmptyState from '../EmptyState.vue'
import FeedbackStylePicker from '../FeedbackStylePicker.vue'
import { friendlyError } from '../../lib/errors.js'
import { listSessions } from '../../services/sessionsApi.js'
import { useUserStore } from '../../stores/user.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const { showSuccess, showError } = useToast()

const sessions = ref([])
const loading = ref(false)
const error = ref('')

function activityTime(s) {
  const raw = s?.last_activity_at || s?.created_at
  const t = raw ? new Date(raw).getTime() : NaN
  return Number.isNaN(t) ? 0 : t
}

const topics = computed(() => [...sessions.value].sort((a, b) => activityTime(b) - activityTime(a)))

// One account-level line: topic count always, mastered total only when it is
// non-zero, and the most recently active session's open focus cue -- the
// per-topic gaps/mastered/focus themselves live on that session's own
// profile page, not here.
const summaryLine = computed(() => {
  const list = topics.value
  const n = list.length
  const parts = [`${n} topic${n === 1 ? '' : 's'}`]
  const mastered = list.reduce((sum, s) => sum + (s?.progress?.mastered_count || 0), 0)
  if (mastered > 0) parts.push(`${mastered} mastered`)
  const focusSession = list.find((s) => s?.progress?.focus_target_gap)
  if (focusSession) parts.push(`focus: ${focusSession.progress.focus_target_gap}`)
  return parts.join(' · ')
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await listSessions()
    sessions.value = Array.isArray(res) ? res : []
  } catch (e) {
    error.value = friendlyError(e)
  }
  loading.value = false
}

onMounted(load)

const feedbackOptions = [
  { value: 'hints', label: 'Hints', sub: 'Nudge me toward the answer.' },
  { value: 'direct_answers', label: 'Direct answers', sub: 'Explain outright when I ask.' },
]

const feedback = ref(user.interactionPreferences?.feedback || 'hints')
const savingFeedback = ref(false)
const feedbackSaved = ref(false)
const feedbackDirty = computed(
  () => feedback.value !== (user.interactionPreferences?.feedback || 'hints'),
)

// The "Saved." flash reads the same way on every Settings save: it stays
// beside the (now idle) button until the learner changes the value again.
watch(feedback, () => {
  feedbackSaved.value = false
})

async function saveFeedback() {
  if (!feedbackDirty.value || savingFeedback.value) return
  savingFeedback.value = true
  try {
    await user.updateProfile({ name: user.name || '', feedback: feedback.value })
    showSuccess('Preferences saved.')
    feedbackSaved.value = true
  } catch (e) {
    showError(friendlyError(e))
  } finally {
    savingFeedback.value = false
  }
}
</script>

<style scoped>
/* The account tab holds only what is true at account level: Feedback style,
   then one pencil summary line (topic count, total mastered when non-zero,
   and the most recently active session's open focus cue) with a link to the
   library. Per-topic gaps, mastered concepts and focus live on that
   session's own profile page; the full per-session list lives in the
   library at /sessions, not duplicated here. */
.profile-tab {
  /* Full panel width. Two independent sections -- Feedback style, then
     Topics -- are their own desk-deep cards, stacked here and sitting side
     by side from 60rem up. */
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--line-pitch);
}

.error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
  background: var(--desk-deep);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem;
}

.sec {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  width: 100%;
  background: var(--desk-deep);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem 1.25rem;
}

.btn-fill-row {
  align-self: flex-start;
}

.sec-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.saved-flash {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.tick {
  flex: 0 0 auto;
  fill: none;
  stroke: var(--ink-learner);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.link {
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link:hover {
  color: var(--color-accent-hover);
}

.link--block {
  display: block;
}

/* Skeleton: a desk-deep card, no shimmer. */
.skel {
  display: flex;
  flex-direction: column;
  background: var(--desk-deep);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem;
}

.skel-block {
  display: block;
  height: calc(var(--line-pitch) - 1px);
  border-bottom: 1px solid var(--rule-strong);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* From 60rem the two cards sit side by side. */
@media (min-width: 60rem) {
  .profile-tab {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .sec {
    grid-column: 1;
  }

  .skel,
  .error,
  [data-testid='profile-summary'] {
    grid-column: 2;
  }
}
</style>

<template>
  <div class="learning-tab" data-testid="agg-learning">
    <section class="sec feedback-sec" data-testid="learning-feedback">
      <h2 class="sec-title">Feedback style</h2>
      <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
      <div class="btn-fill-row">
        <button
          type="button"
          class="btn-fill"
          :class="{ 'btn-fill--busy': savingFeedback }"
          data-testid="learning-feedback-save"
          :disabled="!feedbackDirty || savingFeedback"
          @click="saveFeedback"
        >
          Save feedback style
        </button>
        <span
          v-if="feedbackSaved"
          class="saved-flash"
          role="status"
          data-testid="learning-feedback-saved"
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
    <div v-else-if="error" class="error">
      <p class="error-text" data-testid="agg-error">{{ error }}</p>
      <button type="button" class="retry" data-testid="agg-retry" @click="load">Retry</button>
    </div>

    <template v-else>
      <section class="sec col2-sec" data-testid="learning-topics">
        <h2 class="sec-title">Topics</h2>
        <EmptyState
          v-if="isEmpty"
          data-testid="agg-empty"
          tone="celebrate"
          flat
          headline="No sessions yet"
          subtext="Start one — your profile builds itself as you go."
        >
          <template #cta>
            <router-link to="/new" class="link">Start your first session</router-link>
          </template>
        </EmptyState>
        <ul v-else class="topic-list">
          <li v-for="t in topics" :key="t.id" class="topic-row" data-testid="learning-topic-row">
            <router-link
              :to="{ name: 'session-profile', params: { id: t.id } }"
              class="link topic-link"
              data-testid="learning-topic-link"
            >
              {{ t.topic || 'Untitled' }}
            </router-link>
            <span class="topic-level">
              <svg
                class="topic-level-mark"
                :class="{ 'is-unset': !t.progress?.level }"
                viewBox="0 0 24 24"
                width="20"
                height="14"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(t.progress?.level)" />
              </svg>
              <span class="topic-level-word" :class="{ 'is-unset': !t.progress?.level }">{{
                t.progress?.level || 'level not set'
              }}</span>
            </span>
            <span
              v-if="t.progress?.focus_target_gap"
              class="topic-focus"
              data-testid="learning-topic-focus"
            >
              <span class="sr-only">focus: </span>{{ t.progress.focus_target_gap }}
            </span>
            <span v-else class="topic-focus topic-focus--none">no focus</span>
            <span class="topic-mastered" data-testid="learning-topic-mastered">
              <svg
                class="topic-mastered-tick"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M2 6.5 L4.8 9.2 L10 3.2" />
              </svg>
              {{ t.progress?.mastered_count || 0 }} mastered
            </span>
          </li>
        </ul>
      </section>

      <section v-if="!isEmpty" class="sec col2-sec" data-testid="learning-weekly">
        <h2 class="sec-title">Weekly mastery</h2>
        <template v-if="weeklyHasData">
          <div class="weekly-figure">
            <svg
              class="weekly-svg"
              :viewBox="`0 0 ${weeklyChartWidth} ${WEEKLY_CHART_HEIGHT + 1}`"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            >
              <line
                class="weekly-baseline"
                :x1="0"
                :x2="weeklyChartWidth"
                :y1="WEEKLY_CHART_HEIGHT"
                :y2="WEEKLY_CHART_HEIGHT"
              />
              <rect
                v-for="col in weeklyColumns"
                :key="col.key"
                class="weekly-bar"
                :x="col.x"
                :y="col.barY"
                :width="WEEKLY_BAR_WIDTH"
                :height="col.barHeight"
                rx="4"
                ry="4"
              >
                <title>{{ col.title }}</title>
              </rect>
            </svg>
            <div class="weekly-labels" aria-hidden="true">
              <span v-for="col in weeklyColumns" :key="col.key" class="weekly-label">{{
                col.showLabel ? col.label : ''
              }}</span>
            </div>
          </div>
          <ul class="sr-only" data-testid="learning-weekly-text">
            <li v-for="col in weeklyColumns" :key="col.key">{{ col.title }}</li>
          </ul>
        </template>
        <p v-else class="sec-none">none yet</p>
      </section>

      <section v-if="!isEmpty" class="sec col2-sec" data-testid="learning-accuracy">
        <h2 class="sec-title">Concept accuracy</h2>
        <template v-if="conceptAccuracy.length">
          <div v-for="group in accuracyGroupList" :key="group.key" class="accuracy-group">
            <p v-if="group.label" class="accuracy-group-label">{{ group.label }}</p>
            <ul class="accuracy-list">
              <li
                v-for="c in group.rows"
                :key="c.concept"
                class="accuracy-row"
                data-testid="learning-accuracy-row"
              >
                <span class="accuracy-concept">{{ c.concept }}</span>
                <span class="accuracy-ratio" data-tabular
                  >{{ c.correct_count }} of {{ c.total_count }}</span
                >
                <span class="accuracy-marks">
                  <span class="sr-only">last results, oldest first: </span>
                  <svg
                    v-for="(result, idx) in c.last_results"
                    :key="idx"
                    class="accuracy-mark"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    focusable="false"
                    role="img"
                    :aria-label="result ? 'correct' : 'incorrect'"
                  >
                    <path v-if="result" d="M2 6.5 L4.8 9.2 L10 3.2" />
                    <template v-else>
                      <path d="M2.5 2.5 L9.5 9.5" />
                      <path d="M9.5 2.5 L2.5 9.5" />
                    </template>
                  </svg>
                </span>
              </li>
            </ul>
          </div>
        </template>
        <p v-else class="sec-none">none yet</p>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue'

import EmptyState from '../EmptyState.vue'
import FeedbackStylePicker from '../FeedbackStylePicker.vue'
import { friendlyError } from '../../lib/errors.js'
import { getAggregateProfile } from '../../services/profileApi.js'
import { useUserStore } from '../../stores/user.js'
import { useToast } from '../../composables/useToast.js'
import { LEVEL_MARK_PATH, levelStroke } from '../chat/levelMark.js'

const user = useUserStore()
const { showSuccess, showError } = useToast()

const aggregate = ref(null)
const loading = ref(false)
const error = ref('')

// recent_topics is already sorted created_at desc server-side (see
// AggregateProfileResponse in openapi.yaml), so no client re-sort.
const topics = computed(() => aggregate.value?.recent_topics ?? [])
const weeklyMastery = computed(() => aggregate.value?.weekly_mastery ?? [])
const conceptAccuracy = computed(() => aggregate.value?.concept_accuracy ?? [])

// total_sessions rather than recent_topics.length: a learner with sessions
// but nothing yet surfaced in the "recent" window is not a fresh account.
const isEmpty = computed(() => (aggregate.value?.total_sessions ?? 0) === 0)

async function load() {
  loading.value = true
  error.value = ''
  try {
    aggregate.value = await getAggregateProfile()
  } catch (e) {
    error.value = friendlyError(e)
  }
  loading.value = false
}

onMounted(load)

// E-10: SettingsView keeps the tab alive, so a failed read would otherwise
// stay failed for the rest of the visit. Coming back to the tab retries.
// The guard matters: onActivated also fires on the first mount, right after
// onMounted, and load() clears error synchronously before awaiting, so the
// first activation never doubles the fetch.
onActivated(() => {
  if (error.value) load()
})

function formatWeekLabel(iso) {
  try {
    const d = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  } catch {
    return iso
  }
}

// Small bounded column chart: thin bars, rounded data-ends anchored to the
// baseline, a fixed bar/gap pitch so it never scales with the sheet width
// (see .weekly-figure max-width). Single series -> the green mastered token
// only (tab law: green only Mastered); no legend needed for one series.
const WEEKLY_BAR_WIDTH = 16
const WEEKLY_GAP = 8
const WEEKLY_CHART_HEIGHT = 56

// weekly_mastery is always 12 zero-filled points server-side (see
// _learning_insights in profile_insights.py), even for a fresh account, so
// "has data" is never implied by the array's length -- only by some week
// actually carrying a count.
const weeklyHasData = computed(() => weeklyMastery.value.some((w) => w.count > 0))

const weeklyMax = computed(() => Math.max(...weeklyMastery.value.map((w) => w.count), 1))

const weeklyChartWidth = computed(() => {
  const n = weeklyMastery.value.length
  return n ? n * WEEKLY_BAR_WIDTH + (n - 1) * WEEKLY_GAP : WEEKLY_BAR_WIDTH
})

// 12 captions at this pitch drift off the 20rem figure, so only the first,
// last, and every 4th week (clear of the last one) get a visible caption;
// the rest keep an empty span so the flex slots stay aligned. The per-bar
// <title> and the sr-only list below still carry every date.
const weeklyColumns = computed(() => {
  const points = weeklyMastery.value
  const n = points.length
  return points.map((w, i) => {
    const frac = weeklyMax.value ? w.count / weeklyMax.value : 0
    const barHeight = frac * WEEKLY_CHART_HEIGHT
    const showLabel = i === 0 || i === n - 1 || (i % 4 === 0 && n - 1 - i >= 2)
    return {
      key: w.week_start,
      x: i * (WEEKLY_BAR_WIDTH + WEEKLY_GAP),
      barY: WEEKLY_CHART_HEIGHT - barHeight,
      barHeight,
      label: formatWeekLabel(w.week_start),
      showLabel,
      title: `Week of ${formatWeekLabel(w.week_start)}: ${w.count} mastered`,
    }
  })
})

// Story 31: "the concepts I am most and least accurate on", not the full
// list. The server already sorts concept_accuracy ascending by accuracy, so
// the least-accurate group is the first 3 and the most-accurate group is
// the last 3 -- each kept in server order. When fewer than 6 concepts
// exist the two slices overlap; anything already claimed by the
// least-accurate group is dropped from the most-accurate one so nothing
// repeats and the row count never exceeds the source array's length.
const CONCEPT_ACCURACY_GROUP_SIZE = 3
const accuracyGroupList = computed(() => {
  const all = conceptAccuracy.value
  const least = all.slice(0, CONCEPT_ACCURACY_GROUP_SIZE)
  const leastNames = new Set(least.map((c) => c.concept))
  const most = all.slice(-CONCEPT_ACCURACY_GROUP_SIZE).filter((c) => !leastNames.has(c.concept))
  const showLabels = least.length > 0 && most.length > 0
  const groups = []
  if (least.length) {
    groups.push({ key: 'least', label: showLabels ? 'Least accurate' : null, rows: least })
  }
  if (most.length) {
    groups.push({ key: 'most', label: showLabels ? 'Most accurate' : null, rows: most })
  }
  return groups
})

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
/* The learning tab holds Feedback style, then a Topics overview built from
   the aggregate profile: one row per recent topic (level, focus gap or "no
   focus", mastered count), a weekly mastery column series and a concept
   accuracy list. */
.learning-tab {
  /* Full panel width. Independent sections stacked here and sitting side
     by side from 60rem up. */
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--line-pitch);
}

/* A failed read keeps this tab's card shell -- it sits where the Topics card
   would -- with the retry written beside the line, as in UsageTab. */
.error {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  background: var(--desk-deep);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem;
}

.error-text {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

.retry {
  flex: 0 0 auto;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink-learner);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.retry:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* Card shell, .sec-title, .saved-flash, .tick and .skel-block come from
   assets/sheet.css; only this tab's own alignment is declared here. */
.sec {
  align-items: stretch;
  gap: 0.5rem;
}

.btn-fill-row {
  align-self: flex-start;
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

/* Skeleton: a desk-deep card, no shimmer. */
.skel {
  display: flex;
  flex-direction: column;
  background: var(--desk-deep);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem;
}

.topic-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.topic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 0.9rem;
  padding: 0.4rem 0;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.topic-link {
  flex: 1 1 auto;
  min-width: 6rem;
}

.topic-level {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  flex: 0 0 auto;
}

.topic-level-mark {
  align-self: center;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
}

.topic-level-mark.is-unset {
  stroke: var(--pencil);
}

/* A recorded level is a fact about the row, so it is written in graphite at
   caption weight, same as CueColumn's cue-level-label; "level not set" is
   still a pencil note. */
.topic-level-word {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.topic-level-word.is-unset {
  font-weight: 400;
  color: var(--pencil);
}

.topic-focus {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.topic-focus--none {
  font-weight: 400;
  color: var(--pencil);
  text-decoration: none;
}

.topic-mastered {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.topic-mastered-tick {
  flex: 0 0 auto;
  fill: none;
  stroke: var(--tab-mastered);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Capped measure: the chart must not scale with the sheet. */
.weekly-figure {
  max-width: 20rem;
  margin-top: 0.25rem;
}

.weekly-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.weekly-baseline {
  stroke: var(--rule);
  stroke-width: 1;
}

.weekly-bar {
  fill: var(--tab-mastered);
}

.weekly-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
}

.weekly-label {
  flex: 1 1 0;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  text-align: center;
  white-space: nowrap;
}

/* Shared by the weekly and accuracy sections when a topic-bearing account
   has nothing yet in that particular slice (no mastered week, no graded
   concept), same wording and pencil weight as CueColumn's .cue-none. */
.sec-none {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.accuracy-group + .accuracy-group {
  margin-top: 0.75rem;
}

.accuracy-group-label {
  margin: 0 0 0.25rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.accuracy-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.accuracy-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.9rem;
  padding: 0.4rem 0;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.accuracy-concept {
  flex: 1 1 auto;
  min-width: 6rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.accuracy-ratio {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.accuracy-marks {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
}

/* Grading is the marker's hand, same as .check-mark on the check card: a
   drawn mark beside the line, never a fill. Correctness is exempted from
   the tab law (DESIGN.md), so red here is not a tab colour. */
.accuracy-mark {
  flex: 0 0 auto;
  fill: none;
  stroke: var(--ink-marker);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* From 60rem the cards sit side by side. */
@media (min-width: 60rem) {
  .learning-tab {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .feedback-sec {
    grid-column: 1;
  }

  .skel,
  .error,
  .col2-sec {
    grid-column: 2;
  }
}
</style>

<template>
  <div class="profile-tab" data-testid="agg-profile">
    <p v-if="data?.last_active_at" class="lede">
      Last active {{ formatRelative(data.last_active_at) }}.
    </p>
    <p v-else class="lede">Snapshot of everything the tutor has learned about you.</p>

    <div v-if="loading" class="skel" data-testid="agg-loading" aria-hidden="true">
      <span class="skel-block" />
      <span class="skel-block" />
      <span class="skel-block skel-short" />
    </div>
    <span v-if="loading" class="sr-only" role="status">Loading</span>
    <p v-else-if="error" class="error" data-testid="agg-error">{{ error }}</p>

    <template v-else-if="data">
      <EmptyState
        v-if="data.total_sessions === 0"
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
        <p class="counts" data-testid="agg-stats" data-tabular>
          {{ plural(data.total_sessions, 'session') }} ({{ data.active_sessions }} active,
          {{ data.ended_sessions }} ended) · {{ data.combined_mastered_concepts.length }} mastered ·
          {{ plural(data.combined_confirmed_gaps.length, 'gap') }} ·
          {{ plural(data.total_learning_events, 'check-question') }}
        </p>

        <section class="sec" data-testid="agg-dist">
          <h2 class="sec-title">Knowledge level distribution</h2>
          <ul v-if="distEntries.length" class="cue-list">
            <li v-for="e in distEntries" :key="e.key" class="cue-entry" data-testid="dist-entry">
              <span class="cue-line">
                <svg
                  class="lvl-mark"
                  :class="{ 'lvl-mark--unset': e.key === 'unknown' }"
                  viewBox="0 0 24 24"
                  width="18"
                  height="12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M2 17 L22 7" :stroke-width="levelStroke(e.key)" />
                </svg>
                <span class="lvl-word">{{ e.key }}</span>
                <span class="lvl-count" data-tabular>{{ e.count }}</span>
              </span>
            </li>
          </ul>
        </section>

        <section class="sec" data-testid="agg-insights">
          <h2 class="sec-title">At a glance</h2>
          <p class="glance-line" data-testid="glance-mastery">{{ masteryLine }}</p>

          <template v-if="attentionItems.length">
            <h3 class="sec-title">Needs attention</h3>
            <ul class="cue-list" data-testid="glance-attention">
              <li v-for="c in attentionItems" :key="c.concept" class="cue-entry">
                <router-link
                  :to="{ name: 'session-profile', params: { id: c.first_seen_session_id } }"
                  class="attn-link"
                >
                  <svg
                    class="cue-mark cue-mark--attn"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M1 6 L11 6" />
                  </svg>
                  <span class="attn-word">{{ c.concept }}</span>
                  <span class="attn-pct" data-tabular>({{ c.pct }}%)</span>
                </router-link>
              </li>
            </ul>
          </template>
        </section>

        <div class="cue-cols">
          <section class="sec" data-testid="agg-gaps">
            <h2 class="sec-title">Gaps</h2>
            <p v-if="!data.combined_confirmed_gaps.length" class="cue-none">None yet.</p>
            <ul v-else class="cue-list">
              <li
                v-for="item in data.combined_confirmed_gaps"
                :key="`g-${item.concept}`"
                class="cue-entry"
              >
                <span class="cue-line">
                  <svg
                    class="cue-mark cue-mark--gap"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="6" cy="6" r="4" />
                  </svg>
                  <span class="cue-word">{{ item.concept }}</span>
                  <router-link
                    :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
                    class="cue-count"
                    data-tabular
                    :title="`seen in ${item.count} ${item.count === 1 ? 'session' : 'sessions'}`"
                  >
                    ×{{ item.count }}
                  </router-link>
                </span>
                <span v-if="topicFor(item.first_seen_session_id)" class="cue-sub">
                  {{ topicFor(item.first_seen_session_id) }}
                </span>
              </li>
            </ul>
          </section>

          <section class="sec" data-testid="agg-mastered">
            <h2 class="sec-title">Mastered</h2>
            <p v-if="!data.combined_mastered_concepts.length" class="cue-none">None yet.</p>
            <ul v-else class="cue-list">
              <li
                v-for="item in data.combined_mastered_concepts"
                :key="`m-${item.concept}`"
                class="cue-entry"
              >
                <span class="cue-line">
                  <svg
                    class="cue-mark cue-mark--tick"
                    viewBox="0 0 12 12"
                    width="12"
                    height="12"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M2 6.5 L4.8 9.2 L10 3.2" />
                  </svg>
                  <span class="cue-word">{{ item.concept }}</span>
                  <router-link
                    :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
                    class="cue-count"
                    data-tabular
                    :title="`seen in ${item.count} ${item.count === 1 ? 'session' : 'sessions'}`"
                  >
                    ×{{ item.count }}
                  </router-link>
                </span>
                <span v-if="topicFor(item.first_seen_session_id)" class="cue-sub">
                  {{ topicFor(item.first_seen_session_id) }}
                </span>
              </li>
            </ul>
          </section>
        </div>

        <section class="sec" data-testid="agg-recent">
          <h2 class="sec-title">Recent topics</h2>
          <ul class="recent-list">
            <li v-for="t in data.recent_topics" :key="t.id" class="recent-row">
              <router-link
                :to="{ name: 'session-profile', params: { id: t.id } }"
                class="recent-link"
              >
                <span class="recent-topic">{{ t.topic || 'untitled' }}</span>
                <span class="recent-when">{{ formatRelative(t.created_at) }}</span>
              </router-link>
            </li>
          </ul>
        </section>
      </template>
    </template>

    <section class="sec sec--ruled" data-testid="profile-feedback">
      <h2 class="sec-title">Feedback style</h2>
      <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
      <div class="actions">
        <button
          type="button"
          class="text-btn"
          data-testid="profile-feedback-save"
          :disabled="!feedbackDirty || savingFeedback"
          @click="saveFeedback"
        >
          Save feedback style
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

import EmptyState from '../EmptyState.vue'
import FeedbackStylePicker from '../FeedbackStylePicker.vue'
import { levelStroke } from '../chat/levelMark.js'
import { friendlyError } from '../../lib/errors.js'
import { getAggregateProfile } from '../../services/profileApi.js'
import { formatRelative } from '../../utils/formatDate.js'
import { useUserStore } from '../../stores/user.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const { showSuccess, showError } = useToast()

const data = ref(null)
const loading = ref(false)
const error = ref('')

const levelKeys = ['beginner', 'intermediate', 'advanced', 'unknown']

// The distribution is written as cue entries: the level stroke at its own
// weight, the level word in pencil, the count in pencil label. Levels nobody
// sits at stay off the page rather than reading "0 advanced".
const distEntries = computed(() => {
  const d = data.value?.knowledge_level_distribution || {}
  return levelKeys.filter((k) => (d[k] || 0) > 0).map((k) => ({ key: k, count: d[k] }))
})

const masteryLine = computed(() => {
  const total = data.value?.combined_mastered_concepts.length || 0
  if (total === 0) return 'Nothing mastered yet'
  const weeks = data.value?.weekly_mastery || []
  // weekly_mastery counts first-correct events, which survive later demotions
  // out of mastered_concepts — clamp so "this week" never exceeds the total
  const thisWeek = Math.min(weeks.length ? weeks[weeks.length - 1].count : 0, total)
  return `${thisWeek} mastered this week · ${total} total`
})

// Counts are written the way the cue column writes them: "1 gap", not
// "1 gaps". "mastered" is a participle and never takes a plural.
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The session a cue was first written in, when it is one of the recent topics
// the payload carries; the aggregate API sends ids, not names.
function topicFor(sessionId) {
  if (!sessionId) return ''
  const hit = (data.value?.recent_topics || []).find((t) => t.id === sessionId)
  return hit?.topic || ''
}

const attentionItems = computed(() =>
  (data.value?.concept_accuracy || [])
    .filter((c) => c.total_count >= 2)
    .sort((a, b) => a.accuracy - b.accuracy || a.concept.localeCompare(b.concept))
    .slice(0, 3)
    .map((c) => ({
      concept: c.concept,
      pct: Math.round(c.accuracy * 100),
      first_seen_session_id: c.first_seen_session_id,
    })),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getAggregateProfile()
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
const feedbackDirty = computed(
  () => feedback.value !== (user.interactionPreferences?.feedback || 'hints'),
)

async function saveFeedback() {
  if (!feedbackDirty.value || savingFeedback.value) return
  savingFeedback.value = true
  try {
    await user.updateProfile({ name: user.name || '', feedback: feedback.value })
    showSuccess('Preferences saved.')
  } catch (e) {
    showError(friendlyError(e))
  } finally {
    savingFeedback.value = false
  }
}
</script>

<style scoped>
/* The aggregate profile is the cue column at full width: what the tutor knows
   about you across every session, written as cue words on the pitch. No stat
   cards, no chips, no fills. */
.profile-tab {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.counts {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

.sec {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-top: var(--line-pitch);
}

.sec--ruled {
  margin-top: var(--line-pitch);
  padding-top: calc(var(--line-pitch) - 1px);
  border-top: 1px solid var(--rule-strong);
}

.sec-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.glance-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

/* Needs attention: a cue entry per concept, the whole line the link. The cue
   stays in graphite and is marked in red -- never set in red. */
.attn-link {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.attn-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.attn-word {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.attn-pct {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

/* The level stroke at its weight, then the level word and count in pencil. */
.lvl-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lvl-mark--unset {
  stroke: var(--pencil);
}

.lvl-word {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.lvl-count {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.cue-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 0 2rem;
  width: 100%;
}

.cue-list {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
}

.cue-entry {
  display: flex;
  flex-direction: column;
}

.cue-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.cue-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.cue-mark--gap {
  stroke: var(--pencil);
}

.cue-mark--tick {
  stroke: var(--ink-learner);
}

/* The needs-attention dash: the marker's 2px red stroke. */
.cue-mark--attn {
  stroke: var(--ink-marker);
  stroke-width: 2;
}

.cue-word {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-learner);
  overflow-wrap: anywhere;
}

.cue-count {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  text-decoration: none;
}

.cue-count:hover {
  color: var(--ink-learner);
}

/* The session the cue was first written in, in pencil under the cue. */
.cue-sub {
  padding-left: 1.25rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  overflow-wrap: anywhere;
}

.cue-none {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
}

/* Contents rows: a topic per ruled line, the rule painted so the row keeps the
   pitch. */
.recent-row {
  box-shadow: inset 0 -1px 0 var(--rule);
}

.recent-link {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 0.25rem 0 0;
  color: inherit;
  text-decoration: none;
}

.recent-link:hover .recent-topic {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.recent-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.recent-topic {
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: var(--line-pitch);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.recent-when {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.actions {
  display: inline-flex;
  align-items: baseline;
  gap: 1.25rem;
  flex-wrap: wrap;
  min-height: var(--line-pitch);
}

.text-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.text-btn:hover:not(:disabled) {
  color: var(--color-accent-hover);
}

.text-btn:disabled {
  color: var(--pencil);
  text-decoration: none;
  cursor: default;
}

.text-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
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

/* Skeleton: pencil-weight rules on the pitch, no shimmer. */
.skel {
  display: flex;
  flex-direction: column;
}

.skel-block {
  display: block;
  height: calc(var(--line-pitch) - 1px);
  border-bottom: 1px solid var(--rule-strong);
}

.skel-short {
  width: 55%;
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
</style>

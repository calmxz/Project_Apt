<template>
  <div class="profile-tab" data-testid="agg-profile">
    <p v-if="data?.last_active_at" class="lede">
      Last active {{ formatRelative(data.last_active_at) }}.
    </p>
    <p v-else class="lede">Snapshot of everything the tutor has learned about you.</p>

    <div v-if="loading" class="skel" data-testid="agg-loading" aria-hidden="true">
      <span class="skel-block skel-row-tall" />
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
        eyebrow="page 01"
        headline="No sessions yet"
        subtext="Start one — your profile builds itself as you go."
      >
        <template #cta>
          <router-link to="/new" class="cta-primary">
            <span>Start your first session</span>
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </router-link>
        </template>
      </EmptyState>

      <template v-else>
        <div class="stats" data-testid="agg-stats">
          <div class="stat stat-coral">
            <span class="stat-glyph"><i class="pi pi-bookmark" aria-hidden="true" /></span>
            <span class="stat-label">Sessions</span>
            <span class="stat-value">{{ data.total_sessions }}</span>
            <span class="stat-sub">
              {{ data.active_sessions }} active · {{ data.ended_sessions }} ended
            </span>
          </div>
          <div class="stat stat-green">
            <span class="stat-glyph"><i class="pi pi-check-circle" aria-hidden="true" /></span>
            <span class="stat-label">Mastered</span>
            <span class="stat-value">{{ data.combined_mastered_concepts.length }}</span>
            <span class="stat-sub">unique concepts</span>
          </div>
          <div class="stat stat-yellow">
            <span class="stat-glyph"><i class="pi pi-bolt" aria-hidden="true" /></span>
            <span class="stat-label">Gaps</span>
            <span class="stat-value">{{ data.combined_confirmed_gaps.length }}</span>
            <span class="stat-sub">to revisit</span>
          </div>
          <div class="stat stat-blue">
            <span class="stat-glyph"><i class="pi pi-comments" aria-hidden="true" /></span>
            <span class="stat-label">Events</span>
            <span class="stat-value">{{ data.total_learning_events }}</span>
            <span class="stat-sub">check-questions</span>
          </div>
        </div>

        <div class="dist" data-testid="agg-dist">
          <h2 class="section-title">Knowledge level distribution</h2>
          <p v-if="distLine" class="glance-line">{{ distLine }}</p>
        </div>

        <div class="glance" data-testid="agg-insights">
          <h2 class="sr-only">At a glance</h2>
          <p class="glance-line" data-testid="glance-mastery">{{ masteryLine }}</p>
          <p v-if="attentionLine" class="glance-line" data-testid="glance-attention">
            {{ attentionLine }}
          </p>
        </div>

        <div class="two-col">
          <div class="col" data-testid="agg-mastered">
            <h2 class="section-title">
              <i class="pi pi-check-circle col-icon col-icon-green" aria-hidden="true" />
              Mastered concepts
            </h2>
            <p v-if="!data.combined_mastered_concepts.length" class="muted">None yet.</p>
            <ul v-else class="chip-list">
              <li
                v-for="item in data.combined_mastered_concepts"
                :key="`m-${item.concept}`"
                class="chip chip-mastered"
              >
                <span class="chip-name">{{ item.concept }}</span>
                <router-link
                  :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
                  class="chip-meta"
                  :title="`seen in ${item.count} ${item.count === 1 ? 'session' : 'sessions'}`"
                >
                  ×{{ item.count }}
                </router-link>
              </li>
            </ul>
          </div>

          <div class="col" data-testid="agg-gaps">
            <h2 class="section-title">
              <i class="pi pi-bolt col-icon col-icon-yellow" aria-hidden="true" />
              Confirmed gaps
            </h2>
            <p v-if="!data.combined_confirmed_gaps.length" class="muted">None yet.</p>
            <ul v-else class="chip-list">
              <li
                v-for="item in data.combined_confirmed_gaps"
                :key="`g-${item.concept}`"
                class="chip chip-gap"
              >
                <span class="chip-name">{{ item.concept }}</span>
                <router-link
                  :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
                  class="chip-meta"
                  :title="`seen in ${item.count} ${item.count === 1 ? 'session' : 'sessions'}`"
                >
                  ×{{ item.count }}
                </router-link>
              </li>
            </ul>
          </div>
        </div>

        <div class="recent" data-testid="agg-recent">
          <h2 class="section-title">Recent topics</h2>
          <ul class="recent-list">
            <li v-for="t in data.recent_topics" :key="t.id" class="recent-row">
              <router-link
                :to="{ name: 'session-profile', params: { id: t.id } }"
                class="recent-link"
              >
                <span class="recent-topic">{{ t.topic || 'untitled' }}</span>
                <span class="recent-when">{{ formatRelative(t.created_at) }}</span>
                <i class="pi pi-arrow-right recent-arrow" aria-hidden="true" />
              </router-link>
            </li>
          </ul>
        </div>
      </template>
    </template>

    <section class="card" data-testid="profile-feedback">
      <h2 class="card-title">
        <i class="pi pi-comments card-icon" aria-hidden="true" />
        Feedback style
      </h2>
      <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
      <div class="actions">
        <button
          type="button"
          class="save-btn"
          data-testid="profile-feedback-save"
          :disabled="!feedbackDirty || savingFeedback"
          @click="saveFeedback"
        >
          <i class="pi pi-check" aria-hidden="true" />
          <span>Save feedback style</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

import EmptyState from '../EmptyState.vue'
import FeedbackStylePicker from '../FeedbackStylePicker.vue'
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

const distLine = computed(() => {
  const d = data.value?.knowledge_level_distribution || {}
  return levelKeys
    .filter((k) => (d[k] || 0) > 0)
    .map((k) => `${d[k]} ${k}`)
    .join(' · ')
})

const masteryLine = computed(() => {
  const total = data.value?.combined_mastered_concepts.length || 0
  if (total === 0) return 'Nothing mastered yet'
  const weeks = data.value?.weekly_mastery || []
  const thisWeek = weeks.length ? weeks[weeks.length - 1].count : 0
  return `${thisWeek} mastered this week · ${total} total`
})

const attentionLine = computed(() => {
  const ranked = (data.value?.concept_accuracy || [])
    .filter((c) => c.total_count >= 2)
    .sort((a, b) => a.accuracy - b.accuracy || a.concept.localeCompare(b.concept))
    .slice(0, 3)
  if (!ranked.length) return ''
  const parts = ranked.map((c) => `${c.concept} (${Math.round(c.accuracy * 100)}%)`)
  return `Needs attention: ${parts.join(', ')}`
})

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
.profile-tab {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
  max-width: 32rem;
  font-size: 1rem;
}

.muted {
  color: var(--color-text-muted);
}
.error {
  color: var(--color-error-text);
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.375rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #ffffff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  text-decoration: none;
  cursor: pointer;
  transition: filter var(--motion-fast) ease;
}

.cta-primary:hover {
  filter: brightness(1.08);
}

/* Colorful stat cards */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 1rem;
}

.stat {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1.125rem 1.25rem;
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lift);
  background: var(--color-surface);
  overflow: hidden;
  transition: transform var(--motion-base) var(--motion-bounce);
}

.stat:hover {
  transform: translateY(-2px);
}

.stat-glyph {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  opacity: 0.85;
}

.stat-coral {
  background: linear-gradient(180deg, var(--accent-coral-50) 0%, var(--color-surface) 60%);
}
:root[data-theme='dark'] .stat-coral {
  background: linear-gradient(180deg, rgba(255, 107, 92, 0.18) 0%, var(--color-surface) 70%);
}
.stat-coral .stat-glyph {
  background: var(--accent-coral-200);
  color: var(--accent-coral-700);
}

.stat-green {
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.15) 0%, var(--color-surface) 60%);
}
:root[data-theme='dark'] .stat-green {
  background: linear-gradient(180deg, rgba(52, 215, 123, 0.16) 0%, var(--color-surface) 70%);
}
.stat-green .stat-glyph {
  background: rgba(34, 197, 94, 0.25);
  color: var(--color-success-text);
}

.stat-yellow {
  background: linear-gradient(180deg, rgba(255, 176, 32, 0.18) 0%, var(--color-surface) 60%);
}
:root[data-theme='dark'] .stat-yellow {
  background: linear-gradient(180deg, rgba(255, 197, 77, 0.18) 0%, var(--color-surface) 70%);
}
.stat-yellow .stat-glyph {
  background: rgba(255, 176, 32, 0.28);
  color: var(--color-warning-text);
}
:root[data-theme='dark'] .stat-yellow .stat-glyph {
  color: var(--signal-warning);
}

.stat-blue {
  background: linear-gradient(180deg, rgba(91, 141, 239, 0.15) 0%, var(--color-surface) 60%);
}
:root[data-theme='dark'] .stat-blue {
  background: linear-gradient(180deg, rgba(122, 163, 245, 0.18) 0%, var(--color-surface) 70%);
}
.stat-blue .stat-glyph {
  background: rgba(91, 141, 239, 0.2);
  color: var(--signal-info);
}

.stat-label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
}

.stat-value {
  font-family: var(--font-display);
  font-size: 2.25rem;
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.05;
  letter-spacing: var(--tracking-tight);
}

.stat-sub {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

/* Distribution */
.dist {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.glance {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.glance-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  color: var(--color-text-muted);
}

/* Section + columns */
.section-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0 0 0.875rem 0;
}

.col-icon {
  font-size: 1.05rem;
}
.col-icon-green {
  color: var(--color-success-text);
}
.col-icon-yellow {
  color: var(--color-warning-text);
}

.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 2rem;
}

/* Concept chips */
.chip-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid transparent;
  transition:
    transform var(--motion-fast) var(--motion-bounce),
    filter var(--motion-fast) ease;
}

.chip:hover {
  transform: translateY(-1px);
}

.chip-mastered {
  background: rgba(34, 197, 94, 0.14);
  color: var(--color-success-text);
  border-color: rgba(34, 197, 94, 0.3);
}
:root:not([data-theme='dark']) .chip-mastered {
  color: var(--color-success-text);
}

.chip-gap {
  background: rgba(255, 176, 32, 0.16);
  color: var(--color-warning-text);
  border-color: rgba(255, 176, 32, 0.35);
}
:root[data-theme='dark'] .chip-gap {
  color: var(--signal-warning);
}

.chip-name {
  line-height: 1;
}

.chip-meta {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: inherit;
  opacity: 0.7;
  text-decoration: none;
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.4);
}

:root[data-theme='dark'] .chip-meta {
  background: rgba(255, 255, 255, 0.1);
}

.chip-meta:hover {
  opacity: 1;
}

/* Recent list */
.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recent-row {
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition:
    border-color var(--motion-fast) ease,
    transform var(--motion-fast) var(--motion-bounce);
}

.recent-row:hover {
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}

.recent-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1.125rem;
  color: inherit;
  text-decoration: none;
}

.recent-topic {
  flex: 1;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.recent-when {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.recent-arrow {
  color: var(--color-text-faint);
  font-size: 0.9rem;
  transition:
    transform var(--motion-fast) var(--motion-bounce),
    color var(--motion-fast) ease;
}

.recent-row:hover .recent-arrow {
  color: var(--color-accent-text);
  transform: translateX(3px);
}

.skel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skel-block {
  height: 1.25rem;
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  animation: skel-pulse 1.4s ease-in-out infinite;
}

.skel-row-tall {
  height: 5.5rem;
}

.skel-short {
  width: 55%;
}

@keyframes skel-pulse {
  0%,
  100% {
    opacity: 0.65;
  }
  50% {
    opacity: 0.35;
  }
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

/* Feedback card */
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-paper);
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
}

.card-icon {
  font-size: 1rem;
  color: var(--color-accent-text);
}

.actions {
  display: inline-flex;
  align-items: center;
  gap: 0.875rem;
  flex-wrap: wrap;
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #ffffff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  transition:
    filter var(--motion-fast) ease,
    opacity var(--motion-fast) ease;
}

.save-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.save-btn:active:not(:disabled) {
  filter: brightness(0.95);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}
</style>

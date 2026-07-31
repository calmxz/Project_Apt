<template>
  <section class="agg" data-testid="agg-profile">
    <header class="head">
      <div class="head-text">
        <span class="folio">across all sessions</span>
        <h1 class="title">Your Learning Profile</h1>
        <p v-if="data?.last_active_at" class="lede">
          Last active {{ formatRelative(data.last_active_at) }}.
        </p>
        <p v-else class="lede">Snapshot of everything the tutor has learned about you.</p>
      </div>
    </header>

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
          <div class="dist-bar" role="img" :aria-label="distAriaLabel">
            <span
              v-for="key in levelKeys"
              :key="key"
              :class="['dist-seg', `seg-${key}`]"
              :style="{ flexGrow: data.knowledge_level_distribution[key] || 0 }"
              :title="`${key}: ${data.knowledge_level_distribution[key]}`"
              aria-hidden="true"
            />
          </div>
          <ul class="dist-legend">
            <li v-for="key in levelKeys" :key="key">
              <span :class="['dot', `seg-${key}`]" />
              <span class="dist-key">{{ key }}</span>
              <span class="dist-count">{{ data.knowledge_level_distribution[key] }}</span>
            </li>
          </ul>
        </div>

        <div class="two-col" data-testid="agg-insights">
          <div class="col">
            <WeakestConcepts :concept-accuracy="data.concept_accuracy" />
          </div>
          <div class="col">
            <MasteryTrend :weekly-mastery="data.weekly_mastery" />
          </div>
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

        <UsagePanel v-if="usage" :usage="usage" />
        <p v-else-if="usageError" class="muted" data-testid="usage-error">
          Usage data is unavailable right now.
        </p>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

import EmptyState from '../components/EmptyState.vue'
import MasteryTrend from '../components/profile/MasteryTrend.vue'
import UsagePanel from '../components/profile/UsagePanel.vue'
import WeakestConcepts from '../components/profile/WeakestConcepts.vue'
import { friendlyError } from '../lib/errors.js'
import { getAggregateProfile, getUsageSummary } from '../services/profileApi.js'
import { formatRelative } from '../utils/formatDate.js'

const data = ref(null)
const loading = ref(false)
const error = ref('')
const usage = ref(null)
const usageError = ref(false)

const levelKeys = ['beginner', 'intermediate', 'advanced', 'unknown']

const distAriaLabel = computed(() => {
  const d = data.value?.knowledge_level_distribution || {}
  const parts = levelKeys.map((k) => `${d[k] || 0} ${k}`)
  return `Knowledge level distribution: ${parts.join(', ')}`
})

async function load() {
  loading.value = true
  error.value = ''
  usageError.value = false
  const [agg, use] = await Promise.allSettled([getAggregateProfile(), getUsageSummary()])
  if (agg.status === 'fulfilled') {
    data.value = agg.value
  } else {
    error.value = friendlyError(agg.reason)
  }
  if (use.status === 'fulfilled') {
    usage.value = use.value
  } else {
    usageError.value = true
  }
  loading.value = false
}

onMounted(load)
</script>

<style scoped>
.agg {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
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
  color: var(--color-accent-text);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
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

.dist-bar {
  display: flex;
  height: 0.75rem;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  gap: 2px;
  padding: 2px;
}

.dist-seg {
  display: block;
  min-width: 0;
  border-radius: var(--radius-pill);
}

.seg-beginner {
  background: var(--accent-coral-200);
}
.seg-intermediate {
  background: var(--accent-coral-400);
}
.seg-advanced {
  background: var(--accent-coral-600);
}
.seg-unknown {
  background: var(--color-border-strong);
}

.dist-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  padding: 0;
  margin: 0;
  list-style: none;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.dist-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.dist-key {
  text-transform: capitalize;
}

.dist-count {
  color: var(--color-text-faint);
  font-family: var(--font-mono);
}

.dot {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
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
</style>

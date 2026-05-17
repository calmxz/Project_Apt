<template>
  <section class="agg" data-testid="agg-profile">
    <header class="head">
      <div class="head-text">
        <span class="folio">across all sessions</span>
        <h1 class="title">Your Learning Profile</h1>
        <p class="lede" v-if="data?.last_active_at">
          Last active {{ formatRelative(data.last_active_at) }}.
        </p>
        <p class="lede" v-else>
          Snapshot of everything the tutor has learned about you.
        </p>
      </div>
      <BackButton label="Back to sessions" fallback="/" />
    </header>

    <p v-if="loading" class="muted" data-testid="agg-loading">Loading...</p>
    <p v-else-if="error" class="error" data-testid="agg-error">{{ error }}</p>

    <template v-else-if="data">
      <div v-if="data.total_sessions === 0" class="empty" data-testid="agg-empty">
        <p class="empty-eyebrow">page 01</p>
        <p class="empty-line">No sessions yet.</p>
        <p class="empty-sub">Start one — your profile builds itself as you go.</p>
      </div>

      <template v-else>
        <div class="stats" data-testid="agg-stats">
          <div class="stat">
            <span class="stat-label">Sessions</span>
            <span class="stat-value">{{ data.total_sessions }}</span>
            <span class="stat-sub">
              {{ data.active_sessions }} active &middot; {{ data.ended_sessions }} ended
            </span>
          </div>
          <div class="stat">
            <span class="stat-label">Mastered</span>
            <span class="stat-value">{{ data.combined_mastered_concepts.length }}</span>
            <span class="stat-sub">unique concepts</span>
          </div>
          <div class="stat">
            <span class="stat-label">Gaps</span>
            <span class="stat-value">{{ data.combined_confirmed_gaps.length }}</span>
            <span class="stat-sub">to revisit</span>
          </div>
          <div class="stat">
            <span class="stat-label">Events</span>
            <span class="stat-value">{{ data.total_learning_events }}</span>
            <span class="stat-sub">check-questions</span>
          </div>
        </div>

        <div class="dist" data-testid="agg-dist">
          <h2 class="section-title">Knowledge level distribution</h2>
          <div class="dist-bar">
            <span
              v-for="key in levelKeys"
              :key="key"
              :class="['dist-seg', `seg-${key}`]"
              :style="{ flexGrow: data.knowledge_level_distribution[key] || 0 }"
              :title="`${key}: ${data.knowledge_level_distribution[key]}`"
            />
          </div>
          <ul class="dist-legend">
            <li v-for="key in levelKeys" :key="key">
              <span :class="['dot', `seg-${key}`]" />
              {{ key }}: {{ data.knowledge_level_distribution[key] }}
            </li>
          </ul>
        </div>

        <div class="two-col">
          <div class="col" data-testid="agg-mastered">
            <h2 class="section-title">Mastered concepts</h2>
            <p v-if="!data.combined_mastered_concepts.length" class="muted">
              None yet.
            </p>
            <ul v-else class="concept-list">
              <li
                v-for="item in data.combined_mastered_concepts"
                :key="`m-${item.concept}`"
                class="concept-row"
              >
                <span class="concept-name">{{ item.concept }}</span>
                <span class="concept-meta">
                  seen in {{ item.count }}
                  {{ item.count === 1 ? 'session' : 'sessions' }} &middot;
                  <router-link
                    :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
                    class="meta-link"
                  >
                    first &rarr;
                  </router-link>
                </span>
              </li>
            </ul>
          </div>

          <div class="col" data-testid="agg-gaps">
            <h2 class="section-title">Confirmed gaps</h2>
            <p v-if="!data.combined_confirmed_gaps.length" class="muted">
              None yet.
            </p>
            <ul v-else class="concept-list">
              <li
                v-for="item in data.combined_confirmed_gaps"
                :key="`g-${item.concept}`"
                class="concept-row"
              >
                <span class="concept-name">{{ item.concept }}</span>
                <span class="concept-meta">
                  seen in {{ item.count }}
                  {{ item.count === 1 ? 'session' : 'sessions' }} &middot;
                  <router-link
                    :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
                    class="meta-link"
                  >
                    first &rarr;
                  </router-link>
                </span>
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
              </router-link>
            </li>
          </ul>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'

import BackButton from '../components/BackButton.vue'
import { friendlyError } from '../lib/errors.js'
import { getAggregateProfile } from '../services/profileApi.js'
import { useUserStore } from '../stores/user.js'
import { formatRelative } from '../utils/formatDate.js'

const user = useUserStore()

const data = ref(null)
const loading = ref(false)
const error = ref('')

const levelKeys = ['beginner', 'intermediate', 'advanced', 'unknown']

async function load() {
  if (!user.userId) {
    error.value = 'No user — finish onboarding first.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    data.value = await getAggregateProfile(user.userId)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.agg {
  max-width: 56rem;
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
  gap: 0.375rem;
}

.folio {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.title {
  font-family: var(--font-serif);
  font-size: 2.25rem;
  font-weight: 400;
  font-variation-settings: 'opsz' 144;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
  max-width: 32rem;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error);
}

.empty {
  text-align: left;
  padding: 3rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
  margin: 0;
}

.empty-line {
  font-family: var(--font-serif);
  font-size: 1.5rem;
  font-style: italic;
  color: var(--color-heading);
  margin: 0;
}

.empty-sub {
  margin: 0;
  color: var(--color-text-muted);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-md);
}

.stat-label {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
}

.stat-value {
  font-family: var(--font-serif);
  font-size: 2rem;
  color: var(--color-heading);
  line-height: 1.1;
}

.stat-sub {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
}

.section-title {
  font-family: var(--font-serif);
  font-size: 1.25rem;
  font-weight: 400;
  letter-spacing: var(--tracking-display);
  color: var(--color-heading);
  margin: 0 0 0.75rem 0;
}

.dist-bar {
  display: flex;
  height: 0.625rem;
  border-radius: 999px;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.dist-seg {
  display: block;
  min-width: 0;
}

.seg-beginner { background: #c9d4a3; }
.seg-intermediate { background: #b8854a; }
.seg-advanced { background: #6b4f3b; }
.seg-unknown { background: var(--color-border-strong); }

.dist-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  padding: 0;
  margin: 0.625rem 0 0;
  list-style: none;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
  text-transform: lowercase;
}

.dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  margin-right: 0.375rem;
  vertical-align: middle;
}

.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 2rem;
}

.concept-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.concept-row {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.625rem 0.75rem;
  border-left: 2px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.concept-name {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--color-heading);
}

.concept-meta {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
}

.meta-link {
  color: var(--color-accent);
  text-decoration: none;
}

.meta-link:hover { text-decoration: underline; }

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.recent-row {
  border-bottom: 1px solid var(--color-border);
}

.recent-link {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.625rem 0;
  color: inherit;
  text-decoration: none;
}

.recent-link:hover .recent-topic { color: var(--color-accent); }

.recent-topic {
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  color: var(--color-heading);
}

.recent-when {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
}
</style>

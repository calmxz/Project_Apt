<script setup>
// PROTOTYPE Variant A - "The box's dividers, across every session".
// Cue-first: the aggregate profile is the panel's four dividers written full
// width across all sessions (Level as a distribution, Gaps, Mastered), then
// Topics, then the two figures. Mirrors the per-session ProfileView grammar.
import { computed } from 'vue'

import WeeklyColumns from './WeeklyColumns.vue'
import { LEVEL_MARK_PATH, levelStroke } from '../../../components/chat/levelMark.js'
import { formatRelative } from '../../../utils/formatDate.js'

const props = defineProps({ data: { type: Object, required: true } })

const LEVELS = ['beginner', 'intermediate', 'advanced']

const levelRows = computed(() =>
  LEVELS.map((l) => ({ level: l, count: props.data.knowledge_level_distribution[l] || 0 })),
)
const unknownCount = computed(() => props.data.knowledge_level_distribution.unknown || 0)

const GROUP = 3
const accuracyGroups = computed(() => {
  const all = props.data.concept_accuracy
  const least = all.slice(0, GROUP)
  const names = new Set(least.map((c) => c.concept))
  const most = all.slice(-GROUP).filter((c) => !names.has(c.concept))
  const labels = least.length > 0 && most.length > 0
  const out = []
  if (least.length) out.push({ key: 'least', label: labels ? 'Least accurate' : null, rows: least })
  if (most.length) out.push({ key: 'most', label: labels ? 'Most accurate' : null, rows: most })
  return out
})

function sessionsWord(n) {
  return n === 1 ? 'in 1 session' : `in ${n} sessions`
}
</script>

<template>
  <section class="va">
    <header class="head">
      <div class="head-text">
        <h1 class="title">Your profile</h1>
        <p class="lede">
          {{ data.total_sessions }} sessions, {{ data.active_sessions }} active.
          <template v-if="data.last_active_at">
            Last studied {{ formatRelative(data.last_active_at) }}.
          </template>
        </p>
      </div>
      <div class="head-actions">
        <router-link :to="{ name: 'sessions-library' }" class="text-btn">All sessions</router-link>
      </div>
    </header>

    <section class="divider">
      <h2 class="divider-tab divider-tab--level">
        Level <span class="tab-count">{{ data.total_sessions }}</span>
      </h2>
      <div class="divider-body">
        <ul class="level-list">
          <li v-for="r in levelRows" :key="r.level" class="level-row">
            <svg
              class="level-mark"
              viewBox="0 0 24 24"
              width="18"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(r.level)" />
            </svg>
            <span class="level-word">{{ r.level }}</span>
            <span class="level-count">{{ r.count }} {{ r.count === 1 ? 'topic' : 'topics' }}</span>
          </li>
          <li v-if="unknownCount" class="level-row level-row--unset">
            <svg
              class="level-mark is-unset"
              viewBox="0 0 24 24"
              width="18"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(null)" />
            </svg>
            <span class="level-word is-unset">level not set</span>
            <span class="level-count"
              >{{ unknownCount }} {{ unknownCount === 1 ? 'topic' : 'topics' }}</span
            >
          </li>
        </ul>
      </div>
    </section>

    <section class="divider">
      <h2 class="divider-tab divider-tab--gaps">
        Gaps <span class="tab-count">{{ data.combined_confirmed_gaps.length }}</span>
      </h2>
      <div class="divider-body">
        <p v-if="!data.combined_confirmed_gaps.length" class="cue-none">none open</p>
        <ul v-else class="cue-list">
          <li v-for="g in data.combined_confirmed_gaps" :key="g.concept" class="cue-entry">
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
            <router-link
              :to="{ name: 'session-profile', params: { id: g.first_seen_session_id } }"
              class="cue-word"
            >
              {{ g.concept }}
            </router-link>
            <span v-if="g.count > 1" class="cue-meta">{{ sessionsWord(g.count) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="divider">
      <h2 class="divider-tab divider-tab--mastered">
        Mastered <span class="tab-count">{{ data.combined_mastered_concepts.length }}</span>
      </h2>
      <div class="divider-body">
        <p v-if="!data.combined_mastered_concepts.length" class="cue-none">none yet</p>
        <ul v-else class="cue-list">
          <li v-for="m in data.combined_mastered_concepts" :key="m.concept" class="cue-entry">
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
            <router-link
              :to="{ name: 'session-profile', params: { id: m.first_seen_session_id } }"
              class="cue-word"
            >
              {{ m.concept }}
            </router-link>
            <span v-if="m.count > 1" class="cue-meta">{{ sessionsWord(m.count) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="sec">
      <h2 class="sec-title">Topics</h2>
      <ul class="topic-list">
        <li v-for="t in data.recent_topics" :key="t.id" class="topic-row">
          <router-link :to="{ name: 'session-profile', params: { id: t.id } }" class="topic-link">
            {{ t.topic || 'Untitled' }}
          </router-link>
          <span class="topic-level">
            <svg
              class="level-mark"
              :class="{ 'is-unset': !t.progress?.level }"
              viewBox="0 0 24 24"
              width="18"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(t.progress?.level)" />
            </svg>
            <span class="level-word" :class="{ 'is-unset': !t.progress?.level }">{{
              t.progress?.level || 'level not set'
            }}</span>
          </span>
          <span v-if="t.progress?.focus_target_gap" class="topic-focus"
            ><span class="sr-only">focus: </span>{{ t.progress.focus_target_gap }}</span
          >
          <span v-else class="topic-focus topic-focus--none">no focus</span>
          <span class="topic-mastered">
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
            {{ t.progress?.mastered_count || 0 }} mastered
          </span>
          <span class="topic-when"
            >{{ t.ended_at ? 'ended' : 'active' }}
            {{ formatRelative(t.last_activity_at || t.created_at) }}</span
          >
        </li>
      </ul>
      <router-link :to="{ name: 'sessions-library' }" class="text-btn">See all topics</router-link>
    </section>

    <div class="figures">
      <section class="sec">
        <h2 class="sec-title">Mastered by week</h2>
        <WeeklyColumns :points="data.weekly_mastery" />
      </section>

      <section class="sec">
        <h2 class="sec-title">Check accuracy</h2>
        <p v-if="!data.concept_accuracy.length" class="cue-none">none yet</p>
        <div v-for="g in accuracyGroups" :key="g.key" class="acc-group">
          <p v-if="g.label" class="acc-label">{{ g.label }}</p>
          <ul class="acc-list">
            <li v-for="c in g.rows" :key="c.concept" class="acc-row">
              <router-link
                :to="{ name: 'session-profile', params: { id: c.first_seen_session_id } }"
                class="acc-concept"
                >{{ c.concept }}</router-link
              >
              <span class="acc-ratio">{{ c.correct_count }} of {{ c.total_count }}</span>
              <span class="acc-marks">
                <span class="sr-only">last results, oldest first: </span>
                <svg
                  v-for="(r, i) in c.last_results"
                  :key="i"
                  class="acc-mark"
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  role="img"
                  :aria-label="r ? 'correct' : 'incorrect'"
                  focusable="false"
                >
                  <path v-if="r" d="M2 6.5 L4.8 9.2 L10 3.2" />
                  <template v-else>
                    <path d="M2.5 2.5 L9.5 9.5" />
                    <path d="M9.5 2.5 L2.5 9.5" />
                  </template>
                </svg>
              </span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.va {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--rule-strong);
}

.head-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.head-actions {
  display: flex;
  align-items: flex-end;
}

.divider {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.divider-tab {
  align-self: flex-start;
  margin: 0;
  padding: 0.375rem 1rem;
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  color: var(--tab-ink);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
}

.tab-count {
  font-weight: 400;
  margin-left: 0.35rem;
}

.divider-tab--gaps {
  background: var(--tab-gaps);
}

.divider-tab--mastered {
  background: var(--tab-mastered);
}

.divider-tab--level {
  background: var(--tab-level);
}

.divider-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  width: 100%;
  padding: 1.25rem 1.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: 0 var(--radius-card) var(--radius-card) var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.sec {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1.25rem 1.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.sec-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

.figures {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

@media (min-width: 60rem) {
  .figures {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

.level-list,
.cue-list,
.topic-list,
.acc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
}

.cue-list {
  display: grid;
  grid-template-columns: 1fr;
  column-gap: 2rem;
}

@media (min-width: 60rem) {
  .cue-list {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

.level-row,
.cue-entry {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-height: 1.5rem;
  margin: 0;
}

.level-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
}

.level-mark.is-unset {
  stroke: var(--pencil);
}

.level-word {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

.level-word.is-unset {
  font-weight: 400;
  color: var(--pencil);
}

.level-count,
.cue-meta,
.topic-when {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.cue-word {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink-learner);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.cue-word:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cue-mark {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 0.4rem;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.cue-mark--gap {
  stroke: var(--pencil);
}

.cue-mark--tick {
  stroke: var(--tab-mastered);
}

.cue-none {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.topic-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.5fr) auto auto;
  align-items: baseline;
  gap: 0.5rem 1rem;
  padding: 0.4rem 0;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.topic-link {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink-learner);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.topic-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.topic-level {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.topic-focus {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
  overflow-wrap: anywhere;
}

.topic-focus--none {
  color: var(--pencil);
  text-decoration: none;
}

.topic-mastered {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
  white-space: nowrap;
}

.topic-mastered .cue-mark {
  margin-top: 0;
  align-self: center;
}

.topic-when {
  white-space: nowrap;
}

@media (max-width: 600px) {
  .topic-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .topic-link {
    grid-column: 1 / -1;
  }

  .topic-focus {
    grid-column: 1 / -1;
  }
}

.acc-group + .acc-group {
  margin-top: 0.75rem;
}

.acc-label {
  margin: 0 0 0.25rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.acc-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.9rem;
  padding: 0.4rem 0;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.acc-concept {
  flex: 1 1 auto;
  min-width: 6rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink-learner);
  text-decoration: none;
}

.acc-concept:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.acc-ratio {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.acc-marks {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.acc-mark {
  fill: none;
  stroke: var(--ink-marker);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.text-btn {
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.text-btn:hover {
  color: var(--color-accent-hover);
}
</style>

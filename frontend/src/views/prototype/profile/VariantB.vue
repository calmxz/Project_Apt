<script setup>
// PROTOTYPE Variant B - "Topic ledger".
// Topic-first: the page is a stack of topic cards, each a small profile
// (level stroke, focus underlined red, mastered tick) that opens its session
// profile. The cross-session cues and figures sit below as furniture.
import { computed } from 'vue'

import WeeklyColumns from './WeeklyColumns.vue'
import { LEVEL_MARK_PATH, levelStroke } from '../../../components/chat/levelMark.js'
import { formatRelative } from '../../../utils/formatDate.js'
import { stripAutoPrefix } from '../../../utils/sessionCard.js'

const props = defineProps({ data: { type: Object, required: true } })

const gapsTop = computed(() => props.data.combined_confirmed_gaps.slice(0, 6))
const masteredTop = computed(() => props.data.combined_mastered_concepts.slice(0, 6))
const leastAccurate = computed(() => props.data.concept_accuracy.slice(0, 4))
</script>

<template>
  <section class="vb">
    <header class="head">
      <h1 class="title">Your profile</h1>
      <p class="lede">
        What the tutor knows about you, topic by topic.
        <template v-if="data.last_active_at"
          >Last studied {{ formatRelative(data.last_active_at) }}.</template
        >
      </p>
    </header>

    <ol class="topics">
      <li v-for="t in data.recent_topics" :key="t.id" class="topic-card">
        <p class="card-head">
          <span class="card-role">{{ t.ended_at ? 'ended' : 'active' }}</span>
          <span class="card-time">{{ formatRelative(t.last_activity_at || t.created_at) }}</span>
        </p>
        <router-link :to="{ name: 'session-profile', params: { id: t.id } }" class="topic-name">
          {{ t.topic || 'Untitled' }}
        </router-link>
        <div class="topic-cues">
          <span class="cue">
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
          <span class="cue">
            <svg
              class="cue-mark cue-mark--focus"
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M1 6 L11 6" />
            </svg>
            <span v-if="t.progress?.focus_target_gap" class="focus-word">{{
              t.progress.focus_target_gap
            }}</span>
            <span v-else class="cue-none">no focus cue yet</span>
          </span>
          <span class="cue">
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
            <span class="cue-count">{{ t.progress?.mastered_count || 0 }} mastered</span>
          </span>
        </div>
        <p v-if="t.last_session_summary" class="topic-summary">
          {{ stripAutoPrefix(t.last_session_summary) }}
        </p>
        <p v-else-if="t.last_message_preview" class="topic-summary topic-summary--preview">
          {{ t.last_message_preview }}
        </p>
        <div class="topic-actions">
          <router-link :to="{ name: 'session', params: { id: t.id } }" class="text-btn">
            {{ t.ended_at ? 'Resume' : 'Continue' }}
          </router-link>
          <router-link :to="{ name: 'session-profile', params: { id: t.id } }" class="text-btn"
            >Open profile</router-link
          >
        </div>
      </li>
    </ol>
    <p class="topics-foot">
      Showing {{ data.recent_topics.length }} of {{ data.total_sessions }} topics.
      <router-link :to="{ name: 'sessions-library' }" class="text-btn">See all topics</router-link>
    </p>

    <div class="across">
      <section class="divider">
        <h2 class="divider-tab divider-tab--gaps">
          Gaps <span class="tab-count">{{ data.combined_confirmed_gaps.length }}</span>
        </h2>
        <div class="divider-body">
          <p v-if="!gapsTop.length" class="cue-none">none open</p>
          <ul v-else class="cue-list">
            <li v-for="g in gapsTop" :key="g.concept" class="cue">
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
                >{{ g.concept }}</router-link
              >
              <span v-if="g.count > 1" class="cue-count">x{{ g.count }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section class="divider">
        <h2 class="divider-tab divider-tab--mastered">
          Mastered <span class="tab-count">{{ data.combined_mastered_concepts.length }}</span>
        </h2>
        <div class="divider-body">
          <p v-if="!masteredTop.length" class="cue-none">none yet</p>
          <ul v-else class="cue-list">
            <li v-for="m in masteredTop" :key="m.concept" class="cue">
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
                >{{ m.concept }}</router-link
              >
              <span v-if="m.count > 1" class="cue-count">x{{ m.count }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <div class="figures">
      <section class="sec">
        <h2 class="sec-title">Mastered by week</h2>
        <WeeklyColumns :points="data.weekly_mastery" />
      </section>
      <section class="sec">
        <h2 class="sec-title">Needs another pass</h2>
        <p v-if="!leastAccurate.length" class="cue-none">none yet</p>
        <ul v-else class="acc-list">
          <li v-for="c in leastAccurate" :key="c.concept" class="acc-row">
            <router-link
              :to="{ name: 'session-profile', params: { id: c.first_seen_session_id } }"
              class="acc-concept"
              >{{ c.concept }}</router-link
            >
            <span class="acc-ratio">{{ c.correct_count }} of {{ c.total_count }}</span>
            <span class="acc-marks">
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
      </section>
    </div>
  </section>
</template>

<style scoped>
.vb {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
  display: flex;
  flex-direction: column;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--rule-strong);
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

.topics {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

@media (min-width: 60rem) {
  .topics {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

.topic-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.55rem 0.9rem 0.7rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.card-head {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.card-role {
  font-weight: 700;
}

.topic-name {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
  text-decoration: none;
}

.topic-name:hover {
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.topic-cues {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
}

.cue {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  min-height: 1.5rem;
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

.cue-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.cue-mark--focus {
  stroke: var(--ink-marker);
  stroke-width: 2;
}

.cue-mark--gap {
  stroke: var(--pencil);
}

.cue-mark--tick {
  stroke: var(--tab-mastered);
}

.focus-word {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.cue-none,
.cue-count {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
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

.cue-word:hover,
.acc-concept:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.topic-summary {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.topic-summary--preview {
  font-style: italic;
}

.topic-actions {
  display: flex;
  gap: 1rem;
  margin-top: 0.25rem;
}

.topics-foot {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.across {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

@media (min-width: 60rem) {
  .across {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
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

.divider-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  width: 100%;
  padding: 1rem 1.25rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: 0 var(--radius-card) var(--radius-card) var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.cue-list,
.acc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
}

.cue-list .cue {
  display: flex;
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

.acc-ratio {
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

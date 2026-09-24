<script setup>
// PROTOTYPE Variant C - "Concept ledger".
// Concept-first: one filterable ledger of every concept the tutor has
// recorded across sessions (status mark, session count, check accuracy),
// with a narrow aside holding the topic index, the weekly figure and the
// level distribution. Nothing is a card grid; the ledger is a ruled list.
import { computed, ref } from 'vue'

import WeeklyColumns from './WeeklyColumns.vue'
import { LEVEL_MARK_PATH, levelStroke } from '../../../components/chat/levelMark.js'
import { formatRelative } from '../../../utils/formatDate.js'

const props = defineProps({ data: { type: Object, required: true } })

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'gaps', label: 'Gaps' },
  { key: 'mastered', label: 'Mastered' },
]
const filter = ref('all')

const accuracyByConcept = computed(() => {
  const m = new Map()
  for (const c of props.data.concept_accuracy) m.set(c.concept, c)
  return m
})

const ledger = computed(() => {
  const rows = []
  for (const g of props.data.combined_confirmed_gaps) {
    rows.push({ ...g, status: 'gap', acc: accuracyByConcept.value.get(g.concept) || null })
  }
  for (const m of props.data.combined_mastered_concepts) {
    rows.push({ ...m, status: 'mastered', acc: accuracyByConcept.value.get(m.concept) || null })
  }
  // Gaps first (the work), then mastered; each group in server order
  // (count desc). Least accurate gaps float up inside the gap group.
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'gap' ? -1 : 1
    const aa = a.acc ? a.acc.accuracy : 2
    const ba = b.acc ? b.acc.accuracy : 2
    if (a.status === 'gap' && aa !== ba) return aa - ba
    return b.count - a.count
  })
  return rows
})

const visible = computed(() => {
  if (filter.value === 'gaps') return ledger.value.filter((r) => r.status === 'gap')
  if (filter.value === 'mastered') return ledger.value.filter((r) => r.status === 'mastered')
  return ledger.value
})

const LEVELS = ['beginner', 'intermediate', 'advanced']
const levelRows = computed(() =>
  LEVELS.map((l) => ({ level: l, count: props.data.knowledge_level_distribution[l] || 0 })),
)
</script>

<template>
  <section class="vc">
    <header class="head">
      <h1 class="title">Your profile</h1>
      <p class="lede">
        {{ data.combined_confirmed_gaps.length }} gaps open,
        {{ data.combined_mastered_concepts.length }} concepts mastered across
        {{ data.total_sessions }} topics.
        <template v-if="data.last_active_at"
          >Last studied {{ formatRelative(data.last_active_at) }}.</template
        >
      </p>
    </header>

    <div class="cols">
      <section class="ledger">
        <div class="ledger-head">
          <h2 class="sec-title">Concepts</h2>
          <div class="filters" role="group" aria-label="Filter concepts">
            <button
              v-for="f in FILTERS"
              :key="f.key"
              type="button"
              class="filter"
              :class="{ 'is-on': filter === f.key }"
              :aria-pressed="filter === f.key"
              @click="filter = f.key"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <p v-if="!visible.length" class="cue-none">none yet</p>
        <ul v-else class="rows">
          <li v-for="r in visible" :key="`${r.status}-${r.concept}`" class="row">
            <span class="row-mark">
              <span class="sr-only">{{ r.status === 'gap' ? 'gap' : 'mastered' }}</span>
              <svg
                v-if="r.status === 'gap'"
                class="cue-mark cue-mark--gap"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="6" cy="6" r="4" />
              </svg>
              <svg
                v-else
                class="cue-mark cue-mark--tick"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M2 6.5 L4.8 9.2 L10 3.2" />
              </svg>
            </span>
            <router-link
              :to="{ name: 'session-profile', params: { id: r.first_seen_session_id } }"
              class="row-concept"
              >{{ r.concept }}</router-link
            >
            <span class="row-sessions">{{ r.count === 1 ? '1 topic' : `${r.count} topics` }}</span>
            <span v-if="r.acc" class="row-acc">
              <span class="acc-ratio">{{ r.acc.correct_count }} of {{ r.acc.total_count }}</span>
              <span class="acc-marks">
                <svg
                  v-for="(x, i) in r.acc.last_results"
                  :key="i"
                  class="acc-mark"
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  role="img"
                  :aria-label="x ? 'correct' : 'incorrect'"
                  focusable="false"
                >
                  <path v-if="x" d="M2 6.5 L4.8 9.2 L10 3.2" />
                  <template v-else>
                    <path d="M2.5 2.5 L9.5 9.5" />
                    <path d="M9.5 2.5 L2.5 9.5" />
                  </template>
                </svg>
              </span>
            </span>
            <span v-else class="row-acc row-acc--none">{{
              r.status === 'gap' ? 'not yet checked' : 'declared'
            }}</span>
          </li>
        </ul>
      </section>

      <aside class="aside">
        <section class="sec">
          <h2 class="sec-title">Topics</h2>
          <ul class="topic-list">
            <li v-for="t in data.recent_topics" :key="t.id" class="topic-row">
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
              <router-link
                :to="{ name: 'session-profile', params: { id: t.id } }"
                class="topic-link"
                >{{ t.topic || 'Untitled' }}</router-link
              >
              <span class="topic-meta">{{ t.progress?.mastered_count || 0 }} mastered</span>
            </li>
          </ul>
          <router-link :to="{ name: 'sessions-library' }" class="text-btn"
            >See all topics</router-link
          >
        </section>

        <section class="sec">
          <h2 class="sec-title">Mastered by week</h2>
          <WeeklyColumns :points="data.weekly_mastery" :bar-width="12" :gap="6" :height="44" />
        </section>

        <section class="sec">
          <h2 class="sec-title">Level by topic</h2>
          <ul class="level-list">
            <li v-for="l in levelRows" :key="l.level" class="level-row">
              <svg
                class="level-mark"
                viewBox="0 0 24 24"
                width="18"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(l.level)" />
              </svg>
              <span class="level-word">{{ l.level }}</span>
              <span class="topic-meta">{{ l.count }}</span>
            </li>
            <li v-if="data.knowledge_level_distribution.unknown" class="level-row">
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
              <span class="level-word is-unset">not set</span>
              <span class="topic-meta">{{ data.knowledge_level_distribution.unknown }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.vc {
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

.cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  align-items: start;
}

@media (min-width: 60rem) {
  .cols {
    grid-template-columns: minmax(0, 1fr) 20rem;
  }
}

.ledger {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.25rem 1.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.ledger-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
}

.sec-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

.filters {
  display: inline-flex;
  gap: 1rem;
}

.filter {
  padding: 0 0 2px;
  border: 0;
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink-learner);
  cursor: pointer;
}

.filter.is-on {
  color: var(--ink);
  box-shadow: inset 0 -2px 0 var(--ink);
}

.rows,
.topic-list,
.level-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
}

.row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 0.35rem 0.9rem;
  padding: 0.4rem 0;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.row-mark {
  display: inline-flex;
  align-self: center;
}

.cue-mark {
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

.row-concept,
.topic-link {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink-learner);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.row-concept:hover,
.topic-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.row-sessions,
.acc-ratio,
.topic-meta,
.row-acc--none {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
  white-space: nowrap;
}

.row-acc {
  display: inline-flex;
  align-items: baseline;
  gap: 0.6rem;
  justify-self: end;
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

@media (max-width: 600px) {
  .row {
    grid-template-columns: 12px minmax(0, 1fr) auto;
  }

  .row-acc {
    grid-column: 2 / -1;
    justify-self: start;
  }
}

.aside {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.sec {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1rem 1.25rem 1.25rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.topic-row,
.level-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.5rem;
  min-height: 1.5rem;
}

.level-mark {
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

.cue-none {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
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

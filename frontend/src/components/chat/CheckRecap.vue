<script setup>
import { computed, inject } from 'vue'

// Batch (camelCase, mapped by the session store):
//   { gap, total, setIndex, setTotal, items: [
//     { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
// setIndex / setTotal (1-based, #339) are optional; absent means one set.
const props = defineProps({
  batch: { type: Object, required: true },
})

// PROTOTYPE (#353): multi-set treatment keyed by the injected variant.
const variantRef = inject('checkSetsVariant', null)
const variant = computed(() => variantRef?.value ?? null)
const setIndex = computed(() => props.batch.setIndex ?? 1)
const setTotal = computed(() => props.batch.setTotal ?? 1)
const multi = computed(() => Boolean(variant.value) && setTotal.value > 1)
const hasNext = computed(() => multi.value && setIndex.value < setTotal.value)
function segState(n) {
  return n <= setIndex.value ? 'done' : 'todo'
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']

const items = computed(() => props.batch.items || [])
const graded = computed(() => items.value.filter((it) => it.status === 'answered'))
const nCorrect = computed(() => graded.value.filter((it) => it.correct === true).length)

function optionClass(item, i) {
  if (i === item.correctIndex) return 'is-correct'
  if (item.selectedIndex != null && i === item.selectedIndex) return 'is-incorrect'
  return ''
}
function isYourAnswer(item, i) {
  return item.selectedIndex != null && i === item.selectedIndex
}
</script>

<template>
  <section class="recap-card" data-testid="check-recap">
    <header class="recap-header" :class="{ 'is-segmented': multi && variant === 'B' }">
      <span class="recap-score" data-testid="recap-score" data-tabular>
        {{ nCorrect }} / {{ graded.length }}
      </span>
      <span class="recap-gap">
        {{ batch.gap
        }}<span v-if="multi && variant === 'B'" class="recap-gap-set">
          &middot; set {{ setIndex }} of {{ setTotal }}</span
        >
      </span>
      <span v-if="multi && variant === 'A'" class="recap-set" data-tabular>
        set {{ setIndex }} of {{ setTotal }}
      </span>
      <span
        v-if="multi && variant === 'C'"
        class="recap-setmarks"
        role="img"
        :aria-label="`Set ${setIndex} of ${setTotal}`"
      >
        <svg
          v-for="n in setTotal"
          :key="n"
          class="recap-setmark"
          :class="segState(n)"
          viewBox="0 0 14 11"
          width="14"
          height="11"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="1" y="1" width="12" height="9" rx="1" />
        </svg>
      </span>
    </header>
    <div v-if="multi && variant === 'B'" class="recap-rule" aria-hidden="true">
      <span v-for="n in setTotal" :key="n" class="recap-rule-seg" :class="segState(n)"></span>
    </div>

    <div v-for="(item, qi) in items" :key="qi" class="recap-item">
      <p class="recap-question">{{ item.question }}</p>
      <ul class="recap-options">
        <li
          v-for="(opt, i) in item.options"
          :key="i"
          class="recap-option"
          :class="optionClass(item, i)"
          data-testid="recap-option"
        >
          <span class="recap-letter" aria-hidden="true">{{ LETTERS[i] ?? i + 1 }}.</span>
          <span class="recap-option-text">{{ opt }}</span>
          <span v-if="isYourAnswer(item, i)" class="recap-tag">your answer</span>
          <span v-else-if="i === item.correctIndex" class="recap-tag">correct</span>
          <svg
            v-if="i === item.correctIndex"
            class="recap-mark"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2.5 8.5 L6.3 12.2 L13.5 4" pathLength="1" />
          </svg>
        </li>
      </ul>
      <p v-if="item.selectedIndex == null" class="recap-norecord">Answer not recorded</p>
      <p v-if="item.explanation" class="recap-explanation">{{ item.explanation }}</p>
    </div>
    <p v-if="hasNext && variant === 'B'" class="recap-next">
      set {{ setIndex + 1 }} of {{ setTotal }} follows
    </p>
  </section>
</template>

<style scoped>
/* Same card grammar as the check: the score is set in title-size, text-safe
   red beside the gap name. */
.recap-card {
  max-width: 84%;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  padding: 0.55rem 0.9rem 0.7rem;
  font-family: var(--font-sans);
}

.recap-header {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  padding-bottom: 0.4rem;
  border-bottom: 3px solid var(--ink);
}

.recap-score {
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 600;
  color: var(--ink-marker-text);
}

.recap-gap {
  font-size: var(--fs-caption);
  color: var(--pencil);
}

/* PROTOTYPE (#353) set chrome per variant. */
.recap-set {
  margin-left: auto;
  white-space: nowrap;
  font-size: var(--fs-label);
  color: var(--pencil);
}

/* The score never breaks across lines, whatever the head line beside it. */
.recap-score {
  white-space: nowrap;
}

.recap-gap-set {
  white-space: nowrap;
}

.recap-header.is-segmented {
  border-bottom: 0;
}

.recap-rule {
  display: flex;
  gap: 4px;
  height: 3px;
  margin-top: -0.6rem;
}

.recap-rule-seg {
  flex: 1 1 0;
  background: var(--rule-strong);
}

.recap-rule-seg.done {
  background: var(--ink);
}

.recap-next {
  margin: 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.recap-setmarks {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  align-self: center;
}

.recap-setmark {
  fill: none;
  stroke: var(--pencil);
  stroke-width: 1.5;
}

.recap-setmark.done {
  fill: var(--ink);
  stroke: var(--ink);
}

.recap-item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.recap-question {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

.recap-options {
  list-style: none;
  margin: 0;
  padding: 0;
}

.recap-option {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
}

.recap-letter {
  flex: 0 0 auto;
  color: var(--ink-learner);
  font-weight: 700;
}

.recap-option-text {
  flex: 1 1 auto;
  min-width: 0;
}

/* Your answer is in your own ink; the correct one is ticked in red. */
.recap-option.is-incorrect .recap-option-text {
  color: var(--ink-learner);
  text-decoration: line-through;
  text-decoration-color: var(--ink-marker);
}

/* Not baseline-aligned: a 13px item on a 17px baseline adds half a pixel to
   the option row. Its own line-height is a full pitch, so it still reads level. */
.recap-tag {
  flex-shrink: 0;
  align-self: flex-start;
  font-size: var(--fs-label);
  color: var(--pencil);
}

.recap-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke: var(--ink-marker);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  animation: recap-mark-draw var(--motion-base) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes recap-mark-draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.recap-norecord {
  margin: 0;
  font-size: var(--fs-caption);
  font-style: italic;
  line-height: var(--lh-body);
  color: var(--pencil);
}

.recap-explanation {
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

@media (prefers-reduced-motion: reduce) {
  .recap-mark {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>

<script setup>
import { computed } from 'vue'

// Batch (camelCase, mapped by the session store):
//   { gap, total, items: [
//     { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
const props = defineProps({
  batch: { type: Object, required: true },
})

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
    <header class="recap-header">
      <span class="recap-score" data-testid="recap-score" data-tabular>
        {{ nCorrect }} / {{ graded.length }}
      </span>
      <span class="recap-gap">{{ batch.gap }}</span>
    </header>

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
  </section>
</template>

<style scoped>
/* The marked-up sheet: the score set in red pen beside the gap name. */
.recap-card {
  display: flex;
  flex-direction: column;
  padding: 0 0 var(--line-pitch);
  font-family: var(--font-sans);
}

/* One pitch tall, and the hairline is painted rather than laid out: a
   border-bottom plus baseline-aligned 22px and 14px text made the header 33px
   and pushed every line below it off the rules. */
.recap-header {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  height: var(--line-pitch);
  box-shadow: inset 0 -1px 0 var(--rule-strong);
}

.recap-score {
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 600;
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

.recap-gap {
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.recap-item {
  display: flex;
  flex-direction: column;
}

.recap-question {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--line-pitch);
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
  line-height: var(--line-pitch);
  color: var(--ink);
}

.recap-letter {
  flex: 0 0 auto;
  color: var(--pencil);
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
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.recap-explanation {
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

@media (prefers-reduced-motion: reduce) {
  .recap-mark {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>

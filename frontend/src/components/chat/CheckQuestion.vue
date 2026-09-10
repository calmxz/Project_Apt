<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  // Batch: { gap, total, currentIndex, viewIndex, items: [
  //   { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
  check: { type: Object, required: true },
  // F-04: true while a stream is live; Skip/Next/Done are disabled so the
  // follow-up stream cannot be started on top of an active one.
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['answer', 'skip', 'next', 'done'])

const LETTERS = ['A', 'B', 'C', 'D', 'E']

const item = computed(() => props.check.items[props.check.viewIndex] || {})
const answered = computed(() => item.value.status === 'answered' || item.value.status === 'skipped')
const correct = computed(() => item.value.correct === true)
const isLast = computed(() => props.check.viewIndex >= props.check.total - 1)
const showProgress = computed(() => props.check.total > 1)
// Hidden-until-graded: the explanation is a raise, not a hint.
const graded = computed(() => item.value.status === 'answered')

function optionClass(i) {
  if (item.value.status !== 'answered') return ''
  if (i === item.value.correctIndex) return 'is-correct'
  if (i === item.value.selectedIndex) return 'is-incorrect'
  return ''
}

const nextBtn = ref(null)
const doneBtn = ref(null)

watch(answered, async (is) => {
  if (!is) return
  await nextTick()
  const target = nextBtn.value ?? doneBtn.value
  target?.focus()
})
</script>

<template>
  <section
    class="check-card"
    :class="{ answered, correct, incorrect: answered && !correct }"
    data-testid="check-card"
  >
    <p class="check-label">
      Check question<template v-if="showProgress">
        <span class="check-progress" data-tabular>
          {{ check.viewIndex + 1 }}/{{ check.total }}</span
        ></template
      >
    </p>
    <p class="check-question">{{ item.question }}</p>

    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="check-live"
    >
      <template v-if="graded">
        {{ correct ? 'Correct.' : 'Not quite.' }} {{ item.explanation || '' }}
      </template>
    </div>

    <ul class="check-options">
      <li v-for="(opt, i) in item.options" :key="i">
        <button
          type="button"
          class="check-option"
          :class="optionClass(i)"
          data-testid="check-option"
          :aria-disabled="answered ? 'true' : undefined"
          @click="answered ? undefined : emit('answer', i)"
        >
          <span class="check-letter" aria-hidden="true">{{ LETTERS[i] ?? i + 1 }}.</span>
          <span class="check-option-text">{{ opt }}</span>
          <svg
            v-if="optionClass(i) === 'is-correct'"
            class="check-mark check-mark--tick"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2.5 8.5 L6.3 12.2 L13.5 4" pathLength="1" />
          </svg>
          <svg
            v-else-if="optionClass(i) === 'is-incorrect'"
            class="check-mark check-mark--cross"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M4 4 L12 12" pathLength="1" />
            <path d="M12 4 L4 12" pathLength="1" />
          </svg>
        </button>
      </li>
    </ul>

    <p v-if="graded" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </p>
    <p v-if="graded && item.explanation" class="check-explanation" data-testid="check-explanation">
      {{ item.explanation }}
    </p>

    <button
      v-if="!answered"
      type="button"
      class="check-skip"
      data-testid="check-skip"
      :disabled="busy"
      @click="emit('skip')"
    >
      Skip this question
    </button>

    <button
      v-if="answered && !isLast"
      ref="nextBtn"
      type="button"
      class="check-next"
      data-testid="check-next"
      :disabled="busy"
      @click="emit('next')"
    >
      Next
    </button>
    <button
      v-if="answered && isLast"
      ref="doneBtn"
      type="button"
      class="check-next"
      data-testid="check-done"
      :disabled="busy"
      @click="emit('done')"
    >
      Done
    </button>
  </section>
</template>

<style scoped>
/* A ruled box spanning the notes column: paper over the rules, 1px ink border,
   no radius. The check pauses the page. */
.check-card {
  display: flex;
  flex-direction: column;
  padding: calc(var(--line-pitch) / 2) 1rem;
  border: 1px solid var(--ink);
  background: var(--color-background);
  font-family: var(--font-sans);
}

.check-label {
  margin: 0;
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.check-progress {
  margin-left: 0.5rem;
}

.check-question {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.check-options {
  list-style: none;
  margin: 0;
  padding: 0;
}

.check-option {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--rule);
  border-radius: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
  cursor: pointer;
}

.check-letter {
  flex: 0 0 auto;
  color: var(--ink-learner);
  font-weight: 700;
}

.check-option-text {
  flex: 1 1 auto;
  min-width: 0;
}

.check-option:not([aria-disabled='true']):hover .check-option-text {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.check-option:not([aria-disabled='true']):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.check-option[aria-disabled='true'] {
  cursor: default;
}

/* Grading is the marker's hand: red marks beside the line, never a fill. */
.check-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke: var(--ink-marker);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  animation: mark-draw var(--motion-base) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes mark-draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.check-option.is-incorrect .check-option-text {
  color: var(--pencil);
}

.check-verdict {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.check-card.incorrect .check-verdict {
  color: var(--ink-marker-text);
}

.check-explanation {
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.check-skip,
.check-next {
  align-self: flex-start;
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

.check-skip:disabled,
.check-next:disabled {
  color: var(--pencil);
  cursor: default;
  pointer-events: none;
  text-decoration: none;
}

.check-skip:focus-visible,
.check-next:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .check-mark {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>

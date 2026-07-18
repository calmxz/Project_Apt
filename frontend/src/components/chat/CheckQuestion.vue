<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Batch: { gap, total, currentIndex, viewIndex, items: [
  //   { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
  check: { type: Object, required: true },
  // F-04: true while a stream is live; Skip/Next/Done are disabled so the
  // follow-up stream cannot be started on top of an active one.
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['answer', 'skip', 'next', 'done'])

const item = computed(() => props.check.items[props.check.viewIndex] || {})
const answered = computed(() => item.value.status === 'answered' || item.value.status === 'skipped')
const correct = computed(() => item.value.correct === true)
const isLast = computed(() => props.check.viewIndex >= props.check.total - 1)
const showProgress = computed(() => props.check.total > 1)

function optionClass(i) {
  if (item.value.status !== 'answered') return ''
  if (i === item.value.correctIndex) return 'is-correct'
  if (i === item.value.selectedIndex) return 'is-incorrect'
  return ''
}
</script>

<template>
  <section
    class="check-card"
    :class="{ answered, correct, incorrect: answered && !correct }"
    data-testid="check-card"
  >
    <span class="check-eyebrow">
      Check question<template v-if="showProgress"> &middot; {{ check.viewIndex + 1 }}/{{ check.total }}</template>
    </span>
    <p class="check-question">{{ item.question }}</p>

    <ul class="check-options">
      <li v-for="(opt, i) in item.options" :key="i">
        <button
          type="button"
          class="check-option"
          :class="optionClass(i)"
          data-testid="check-option"
          :disabled="answered"
          @click="emit('answer', i)"
        >
          {{ opt }}
        </button>
      </li>
    </ul>

    <div v-if="item.status === 'answered'" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </div>
    <p v-if="item.status === 'answered' && item.explanation" class="check-explanation">
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
.check-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.125rem;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: var(--color-accent-soft);
}
.check-eyebrow {
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}
.check-question {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}
.check-options {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.check-option {
  width: 100%;
  text-align: left;
  background: var(--color-surface, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 0.6rem);
  padding: 0.6rem 0.85rem;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.check-option:not(:disabled):hover {
  border-color: var(--color-accent);
}
.check-option:not(:disabled):focus-visible {
  border-color: var(--color-accent);
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
.check-option:disabled {
  cursor: default;
}
.check-option.is-correct {
  border-color: var(--signal-success, #2e7d32);
  background: color-mix(in srgb, var(--signal-success, #2e7d32) 14%, transparent);
}
.check-option.is-incorrect {
  border-color: var(--signal-warning, #b26a00);
  background: color-mix(in srgb, var(--signal-warning, #b26a00) 14%, transparent);
}
.check-skip {
  align-self: flex-start;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.35rem 0.9rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  cursor: pointer;
}
.check-skip:disabled,
.check-next:disabled {
  opacity: 0.55;
  cursor: default;
  pointer-events: none;
}
.check-skip:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.check-skip:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-accent);
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
.check-verdict {
  font-weight: 600;
}
.check-explanation {
  margin: 0;
  color: var(--color-text-muted);
}
.check-card.correct {
  border-color: var(--signal-success, #2e7d32);
}
.check-card.incorrect {
  border-color: var(--signal-warning, #b26a00);
}
.check-next {
  align-self: flex-start;
  background: var(--color-accent-strong);
  /* On the solid accent fill, foreground must be light. --color-accent-text is
     the accent COLOR itself (for text on dark surfaces, e.g. the eyebrow), so it
     would render coral-on-coral (invisible). Use the app's on-accent light text. */
  color: var(--color-text-on-accent);
  border: 1px solid var(--color-accent-strong);
  border-radius: var(--radius-pill);
  padding: 0.4rem 1.1rem;
  font-weight: 600;
  cursor: pointer;
}
.check-next:hover {
  filter: brightness(1.05);
}
.check-next:focus-visible {
  filter: brightness(1.05);
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // { gap, question, options, verdict: boolean|null, selectedIndex?, correctIndex?, explanation? }
  check: { type: Object, required: true },
})
const emit = defineEmits(['answer', 'skip'])

const answered = computed(() => props.check.verdict !== null)
const correct = computed(() => props.check.verdict === true)

function optionClass(i) {
  if (!answered.value) return ''
  if (i === props.check.correctIndex) return 'is-correct'
  if (i === props.check.selectedIndex) return 'is-incorrect'
  return ''
}
</script>

<template>
  <section
    class="check-card"
    :class="{ answered, correct, incorrect: answered && !correct }"
    data-testid="check-card"
  >
    <span class="check-eyebrow">Check question</span>
    <p class="check-question">{{ check.question }}</p>

    <ul class="check-options">
      <li v-for="(opt, i) in check.options" :key="i">
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

    <div v-if="answered" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </div>
    <p v-if="answered && check.explanation" class="check-explanation">
      {{ check.explanation }}
    </p>

    <button
      v-if="!answered"
      type="button"
      class="check-skip"
      data-testid="check-skip"
      @click="emit('skip')"
    >
      Skip this question
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
.check-option:not(:disabled):hover,
.check-option:not(:disabled):focus-visible {
  border-color: var(--color-accent);
  outline: none;
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
.check-skip:hover,
.check-skip:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-accent);
  outline: none;
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
</style>

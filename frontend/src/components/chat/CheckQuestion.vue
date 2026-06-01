<script setup>
import { computed } from 'vue'

const props = defineProps({
  check: { type: Object, required: true }, // { gap, question, verdict: boolean|null }
})
const emit = defineEmits(['skip'])

const answered = computed(() => props.check.verdict !== null)
const correct = computed(() => props.check.verdict === true)
</script>

<template>
  <section class="check-card" :class="{ answered, correct, incorrect: answered && !correct }" data-testid="check-card">
    <span class="check-eyebrow">Check question</span>
    <p class="check-question">{{ check.question }}</p>
    <div v-if="answered" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </div>
    <button
      v-else
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
.check-card.correct {
  border-color: var(--signal-success, #2e7d32);
}
.check-card.incorrect {
  border-color: var(--signal-warning, #b26a00);
}
</style>

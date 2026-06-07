<script setup>
import { computed } from 'vue'

// Batch (camelCase, mapped by the session store):
//   { gap, total, items: [
//     { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
const props = defineProps({
  batch: { type: Object, required: true },
})

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
      <span class="recap-eyebrow">Check question recap</span>
      <span class="recap-score" data-testid="recap-score">
        {{ nCorrect }} / {{ graded.length }} &middot; {{ batch.gap }}
      </span>
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
          <span class="recap-option-text">{{ opt }}</span>
          <span v-if="isYourAnswer(item, i)" class="recap-tag">your answer</span>
          <span v-else-if="i === item.correctIndex" class="recap-tag">correct</span>
        </li>
      </ul>
      <p
        v-if="item.selectedIndex == null"
        class="recap-norecord"
      >
        Answer not recorded
      </p>
      <p v-if="item.explanation" class="recap-explanation">{{ item.explanation }}</p>
    </div>
  </section>
</template>

<style scoped>
.recap-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
}
.recap-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.recap-eyebrow {
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-faint);
}
.recap-score {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-muted);
}
.recap-item {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.recap-question {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}
.recap-options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.recap-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 0.6rem);
  color: var(--color-text);
}
.recap-option.is-correct {
  border-color: var(--signal-success, #2e7d32);
  background: color-mix(in srgb, var(--signal-success, #2e7d32) 14%, transparent);
}
.recap-option.is-incorrect {
  border-color: var(--signal-warning, #b26a00);
  background: color-mix(in srgb, var(--signal-warning, #b26a00) 14%, transparent);
}
.recap-tag {
  flex-shrink: 0;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
}
.recap-norecord {
  margin: 0;
  font-size: 0.8125rem;
  font-style: italic;
  color: var(--color-text-muted);
}
.recap-explanation {
  margin: 0;
  color: var(--color-text-muted);
}
</style>

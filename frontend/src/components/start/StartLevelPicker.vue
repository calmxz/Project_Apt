<script setup>
defineProps({
  busy: { type: Boolean, default: false },
})
defineEmits(['select', 'quiz', 'skip'])

const LEVELS = [
  { value: 'beginner', label: 'New to this' },
  { value: 'intermediate', label: 'Know some' },
  { value: 'advanced', label: 'Know it well' },
]
</script>

<template>
  <div class="level-picker" role="group" aria-label="How well do you know this topic?">
    <p class="level-title">How well do you know this?</p>
    <div class="level-chips">
      <button
        v-for="lvl in LEVELS"
        :key="lvl.value"
        type="button"
        class="level-chip"
        :data-testid="`start-level-${lvl.value}`"
        :disabled="busy"
        @click="$emit('select', lvl.value)"
      >
        {{ lvl.label }}
      </button>
      <button
        type="button"
        class="level-chip level-chip-quiz"
        data-testid="start-level-quiz"
        :disabled="busy"
        @click="$emit('quiz')"
      >
        Quiz me (3 questions)
      </button>
    </div>
    <button
      type="button"
      class="level-skip"
      data-testid="start-level-skip"
      :disabled="busy"
      @click="$emit('skip')"
    >
      Skip
    </button>
  </div>
</template>

<style scoped>
.level-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}

.level-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.level-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}

.level-chip {
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease,
    border-color var(--motion-fast) ease;
}

.level-chip:hover:not(:disabled) {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}

.level-chip:disabled,
.level-skip:disabled {
  opacity: 0.5;
  cursor: default;
}

.level-chip-quiz {
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

.level-skip {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  cursor: pointer;
  text-decoration: underline;
}
</style>

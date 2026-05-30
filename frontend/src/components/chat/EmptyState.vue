<template>
  <div
    v-if="!archived"
    class="empty"
    data-testid="session-empty"
  >
    <svg
      class="empty-spark"
      viewBox="0 0 24 24"
      width="40"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 0.5 L13.6 10.4 L23.5 12 L13.6 13.6 L12 23.5 L10.4 13.6 L0.5 12 L10.4 10.4 Z"
        fill="currentColor"
      />
    </svg>
    <span class="empty-eyebrow">begin</span>
    <p class="empty-line">Send a question or share what you already know.</p>
    <div class="quick-prompts">
      <button
        v-for="(p, i) in quickPrompts"
        :key="i"
        type="button"
        class="quick-prompt"
        :data-testid="`quick-prompt-${i}`"
        @click="$emit('quick-prompt', p)"
      >
        {{ p }}
      </button>
    </div>
  </div>

  <div
    v-else
    class="empty archived-empty"
  >
    <span class="empty-eyebrow">archive</span>
    <span class="empty-line">No transcript stored for this session.</span>
  </div>
</template>

<script setup>
defineProps({
  archived: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['quick-prompt'])

const quickPrompts = [
  'Where should I start with this topic?',
  'Quiz me on what I should already know.',
  'Explain the core idea in two sentences.',
]
</script>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.625rem;
  padding: 1.75rem 1rem 1.25rem;
  margin: 0;
}

.empty-spark {
  color: var(--color-accent);
  margin-bottom: 0.125rem;
  filter: drop-shadow(0 2px 12px rgba(255, 107, 92, 0.35));
  animation: spark-breath 4.5s ease-in-out infinite;
}

@keyframes spark-breath {
  0%, 100% { transform: rotate(0deg) scale(1); opacity: 0.9; }
  50% { transform: rotate(18deg) scale(1.06); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .empty-spark { animation: none; }
}

.empty-eyebrow {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}

.empty-line {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.archived-empty .empty-eyebrow {
  color: var(--color-text-muted);
}
.archived-empty .empty-line {
  color: var(--color-text-muted);
  font-weight: 500;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  max-width: 36rem;
}

.quick-prompt {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.5rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.quick-prompt:hover,
.quick-prompt:focus-visible {
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
  color: var(--color-accent);
  transform: translateY(-1px);
  outline: none;
}
</style>

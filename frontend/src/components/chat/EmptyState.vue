<template>
  <div v-if="!archived" class="empty" data-testid="session-empty">
    <svg
      class="empty-spark"
      viewBox="0 0 48 28"
      width="48"
      height="28"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 4 H48 M0 14 H48 M0 24 H48" />
    </svg>
    <p class="empty-eyebrow">begin</p>
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

  <div v-else class="empty archived-empty">
    <p class="empty-eyebrow">archive</p>
    <p class="empty-line">No transcript stored for this session.</p>
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
/* An empty sheet: three feint rules and a pencil prompt line. */
.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--line-pitch) 0 0 4.75rem;
}

.empty-spark {
  fill: none;
  stroke: var(--rule-strong);
  stroke-width: 1;
  margin-bottom: 4px;
}

.empty-eyebrow {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.empty-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.archived-empty .empty-line {
  color: var(--pencil);
}

.quick-prompts {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 42ch;
}

.quick-prompt {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-learner);
  cursor: pointer;
  text-align: left;
}

.quick-prompt:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.quick-prompt:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (max-width: 599px) {
  .empty {
    padding-left: 0;
  }
}
</style>

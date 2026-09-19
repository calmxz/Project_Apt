<template>
  <div v-if="!archived" class="empty" data-testid="session-empty">
    <div class="empty-head">
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
    </div>
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
    <div class="empty-head">
      <p class="empty-eyebrow">archive</p>
    </div>
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
/* A single centred card: no ruled ground behind it any more. */
.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 32rem;
  margin: 2rem auto;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  padding: 1rem 1.25rem 1.2rem;
}

.empty-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 4px;
}

.empty-spark {
  fill: none;
  stroke: var(--rule-strong);
  stroke-width: 1;
}

/* A pencil aside beside the drawn mark, not a stacked eyebrow label. */
.empty-eyebrow {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--pencil);
}

.empty-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
}

.archived-empty .empty-line {
  color: var(--pencil);
}

.quick-prompts {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  margin-top: 0.75rem;
  max-width: 42ch;
}

.quick-prompt {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
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
    margin: 1.25rem auto;
    max-width: 100%;
  }
}
</style>

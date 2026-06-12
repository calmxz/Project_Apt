<script setup>
defineProps({
  /** Optional id so consumers can reference the chip row from aria-describedby. */
  id: { type: String, default: undefined },
  /** Output of cardChips(session): [{ type, label, count? }]. */
  chips: { type: Array, required: true },
  /** 'rail' (sidebar, compact) | 'card' (home/library, full-size). */
  variant: {
    type: String,
    default: 'card',
    validator: (v) => ['rail', 'card'].includes(v),
  },
})
</script>

<template>
  <span class="chips" :id="id" :class="`chips--${variant}`" data-testid="session-chips">
    <template v-for="chip in chips" :key="chip.type">
      <span v-if="chip.type === 'focus'" class="chip chip--focus" data-testid="chip-focus">
        <span class="chip-glyph" aria-hidden="true">&#9678;</span>
        <span v-if="variant !== 'card'" class="sr-only">Focus:</span>
        <!-- single text node so the "Focus: " space is a real space, not NBSP/condensed -->
        <span class="chip-text">{{ variant === 'card' ? `Focus: ${chip.label}` : chip.label }}</span>
      </span>
      <span
        v-else-if="chip.type === 'mastered'"
        class="chip chip--mastered"
        data-testid="chip-mastered"
      >
        <span class="chip-glyph" aria-hidden="true">&#10003;</span>
        <span class="chip-text">{{ variant === 'card' ? chip.label : chip.count }}</span>
        <span v-if="variant !== 'card'" class="sr-only"> mastered</span>
      </span>
    </template>
  </span>
</template>

<style scoped>
.chips {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  max-width: 100%;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  max-width: 100%;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  white-space: nowrap;
}

.chip--focus {
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  color: var(--color-accent-text);
}

.chip--mastered {
  /* fixed-content chip: never shrinks; the focus chip absorbs all flex shrinkage */
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--signal-success, #0a7);
  color: var(--signal-success, #0a7);
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.chips--rail .chip {
  font-size: var(--fs-label);
  line-height: 1.5;
  padding: 0 0.4375rem;
}

.chips--rail .chip--focus .chip-text {
  max-width: 8rem;
}

.chips--card .chip {
  font-size: 0.75rem;
  padding: 0.125rem 0.5625rem;
}

.chips--card .chip--focus .chip-text {
  max-width: 18rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

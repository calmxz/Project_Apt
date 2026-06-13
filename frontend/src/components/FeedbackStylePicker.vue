<script setup>
// Shared feedback-style control used by both Settings and Onboarding. Native
// radio cards (not a PrimeVue SelectButton) so the two screens stay consistent
// and accessible. Each option needs `value` + `label`; an optional `sub`
// renders as a description line.
defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, required: true },
})

const emit = defineEmits(['update:modelValue'])

function select(value) {
  emit('update:modelValue', value)
}
</script>

<template>
  <fieldset class="radio-group">
    <legend class="sr-only">Feedback style</legend>
    <label
      v-for="opt in options"
      :key="opt.value"
      :class="['radio-row', { selected: modelValue === opt.value }]"
    >
      <input
        type="radio"
        :value="opt.value"
        :checked="modelValue === opt.value"
        :data-testid="`feedback-style-${opt.value}`"
        class="radio-input"
        @change="select(opt.value)"
      />
      <span class="radio-dot" aria-hidden="true">
        <span class="radio-dot-inner" />
      </span>
      <span class="radio-body">
        <span class="radio-label">{{ opt.label }}</span>
        <span v-if="opt.sub" class="radio-sub">{{ opt.sub }}</span>
      </span>
    </label>
  </fieldset>
</template>

<style scoped>
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

/* Radio cards */
.radio-group {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.radio-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--color-surface-soft);
  transition: border-color var(--motion-fast) ease, background var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.radio-row:hover {
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}

.radio-row.selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.radio-row:has(.radio-input:focus-visible) {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.radio-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.radio-dot {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: var(--radius-pill);
  border: 2px solid var(--color-border-strong);
  background: var(--color-surface);
  margin-top: 0.125rem;
  transition: border-color var(--motion-fast) ease;
}

.radio-row.selected .radio-dot {
  border-color: var(--color-accent);
}

.radio-dot-inner {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transform: scale(0);
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.radio-row.selected .radio-dot-inner {
  transform: scale(1);
}

.radio-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.radio-label {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.radio-sub {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
</style>

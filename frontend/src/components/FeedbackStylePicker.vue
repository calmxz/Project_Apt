<script setup>
import { computed, useId } from 'vue'

// Shared feedback-style control used by both Settings and Onboarding. Native
// radios (not a PrimeVue SelectButton) so the two screens stay consistent and
// accessible. Each option needs `value` + `label`; an optional `sub` renders
// as a description line. Visually the options are lettered lines, the same
// grammar as the check-question options on the sheet.
const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, required: true },
  // Radio-group name. All inputs in one instance share this so they form a
  // single native radio group (arrow-key roving, mutual exclusivity, AT
  // "1 of N"). Defaults to a per-instance unique id so two pickers mounted on
  // different views never collide; callers may override.
  name: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const generatedId = useId()
const groupName = computed(() => props.name || `fsp-${generatedId}`)

// A. / B. / C. -- the option letters used by every check on the sheet.
function letter(i) {
  return String.fromCharCode(65 + i)
}

function select(value) {
  emit('update:modelValue', value)
}
</script>

<template>
  <fieldset class="radio-group">
    <legend class="sr-only">Feedback style</legend>
    <label
      v-for="(opt, i) in options"
      :key="opt.value"
      :class="['radio-row', { selected: modelValue === opt.value }]"
    >
      <input
        type="radio"
        :name="groupName"
        :value="opt.value"
        :checked="modelValue === opt.value"
        :data-testid="`feedback-style-${opt.value}`"
        class="radio-input"
        @change="select(opt.value)"
      />
      <span class="radio-letter" aria-hidden="true">{{ letter(i) }}.</span>
      <span class="radio-body">
        <span class="radio-label">{{ opt.label }}</span>
        <span v-if="opt.sub" class="radio-sub">{{ opt.sub }}</span>
      </span>
      <svg
        v-if="modelValue === opt.value"
        class="radio-tick"
        viewBox="0 0 12 12"
        width="12"
        height="12"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2 6.5 L4.8 9.2 L10 3.2" />
      </svg>
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

/* Two lettered lines, each on the pitch, separated by a painted feint rule so
   the line stays 28px tall. No card, no dot, no fill. */
.radio-group {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}

.radio-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: 0.5rem;
  padding: 0;
  cursor: pointer;
  background: transparent;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.radio-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.radio-letter {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--color-accent);
}

.radio-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.radio-label {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.radio-row.selected .radio-label {
  font-weight: 700;
}

.radio-row:hover .radio-label {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.radio-sub {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

/* Blue tick: a control state, not a Mastered signal. Tab-colour law
   reserves green for Mastered only, so the picker's own selected-state
   mark uses the same learner-blue ink as other interactive affordances. */
.radio-tick {
  align-self: center;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--ink-learner);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.radio-row:has(.radio-input:focus-visible) {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

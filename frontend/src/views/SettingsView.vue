<template>
  <section class="settings" data-testid="settings">
    <BackButton fallback="/" />

    <header class="head">
      <span class="folio">preferences</span>
      <h1 class="title">Settings</h1>
      <p class="lede">Tune how the tutor addresses you and the kind of feedback you want.</p>
    </header>

    <form class="form" @submit.prevent="save">
      <div class="field">
        <label class="lbl" for="set-name">Display name</label>
        <input
          id="set-name"
          v-model="displayName"
          data-testid="settings-name"
          maxlength="40"
          class="input"
          type="text"
        />
        <p class="hint">How the tutor refers to you.</p>
      </div>

      <fieldset class="field field-radio">
        <legend class="lbl">Feedback style</legend>
        <label
          v-for="opt in feedbackOptions"
          :key="opt.value"
          :class="['radio-row', { selected: feedback === opt.value }]"
        >
          <input
            type="radio"
            :value="opt.value"
            v-model="feedback"
            :data-testid="`settings-feedback-${opt.value}`"
          />
          <span class="radio-label">{{ opt.label }}</span>
          <span class="radio-sub">{{ opt.sub }}</span>
        </label>
      </fieldset>

      <div class="actions">
        <Button
          type="submit"
          label="Save preferences"
          icon="pi pi-check"
          data-testid="settings-save"
          :disabled="!dirty"
        />
        <span v-if="savedFlash" class="saved-flash" data-testid="settings-saved">
          Saved.
        </span>
      </div>
    </form>

    <div class="danger" data-testid="settings-danger">
      <h2 class="danger-title">Danger zone</h2>
      <p class="muted">
        Reset removes your local profile and runs onboarding again. Sessions on the server stay put.
      </p>
      <router-link
        to="/onboarding?retake=1"
        class="danger-link"
        data-testid="settings-retake-onboarding"
      >
        Retake onboarding &rarr;
      </router-link>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import Button from 'primevue/button'

import BackButton from '../components/BackButton.vue'
import { useUserStore } from '../stores/user.js'
import { useToast } from '../composables/useToast.js'

const user = useUserStore()
const { showSuccess } = useToast()

const feedbackOptions = [
  { value: 'hints', label: 'Hints', sub: 'Nudge me toward the answer.' },
  {
    value: 'direct_answers',
    label: 'Direct answers',
    sub: 'Explain outright when I ask.',
  },
]

const displayName = ref(user.name || '')
const feedback = ref(user.interactionPreferences?.feedback || 'hints')
const savedFlash = ref(false)

const dirty = computed(() => {
  const nameChanged = (displayName.value || '').trim() !== (user.name || '')
  const feedbackChanged =
    feedback.value !== (user.interactionPreferences?.feedback || 'hints')
  return nameChanged || feedbackChanged
})

watch([displayName, feedback], () => {
  savedFlash.value = false
})

function save() {
  user.updateProfile({ name: displayName.value, feedback: feedback.value })
  savedFlash.value = true
  showSuccess('Preferences saved.')
}
</script>

<style scoped>
.settings {
  max-width: 40rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.folio {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.title {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 400;
  font-variation-settings: 'opsz' 144;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
}

.muted { color: var(--color-text-muted); }

.form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field-radio {
  border: 0;
  padding: 0;
  margin: 0;
  gap: 0.5rem;
}

.lbl {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
}

.input {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-heading);
  font-family: var(--font-sans);
  font-size: 1rem;
}

.input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.hint {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
}

.radio-row {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.625rem;
  row-gap: 0.125rem;
  align-items: center;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--color-surface);
  transition: border-color 180ms ease, background 180ms ease;
}

.radio-row:hover { border-color: var(--color-border-strong); }
.radio-row.selected { border-color: var(--color-accent); }

.radio-label {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--color-heading);
}

.radio-sub {
  grid-column: 2;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
}

.actions {
  display: inline-flex;
  align-items: center;
  gap: 0.875rem;
}

.saved-flash {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--signal-success, #6b7d4e);
}

.danger {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px dashed var(--signal-error);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--signal-error) 4%, transparent);
}

.danger-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.125rem;
  color: var(--signal-error);
}

.danger-link {
  align-self: flex-start;
  color: var(--signal-error);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

.danger-link:hover { text-decoration: underline; }
</style>

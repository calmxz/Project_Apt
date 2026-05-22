<template>
  <section class="settings" data-testid="settings">
    <BackButton fallback="/" />

    <header class="head">
      <span class="folio">preferences</span>
      <h1 class="title">Settings</h1>
      <p class="lede">Tune how the tutor addresses you and the kind of feedback you want.</p>
    </header>

    <form class="form" @submit.prevent="save">
      <section class="card">
        <h2 class="card-title">
          <i class="pi pi-user card-icon" aria-hidden="true" />
          Account
        </h2>
        <div class="field">
          <label class="lbl" for="set-name">Display name</label>
          <input
            id="set-name"
            v-model="displayName"
            data-testid="settings-name"
            maxlength="40"
            class="input"
            type="text"
            placeholder="Learner"
          />
          <p class="hint">How the tutor refers to you.</p>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">
          <i class="pi pi-comments card-icon" aria-hidden="true" />
          Feedback style
        </h2>
        <fieldset class="radio-group">
          <legend class="sr-only">Feedback style</legend>
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
              class="radio-input"
            />
            <span class="radio-dot" aria-hidden="true">
              <span class="radio-dot-inner" />
            </span>
            <span class="radio-body">
              <span class="radio-label">{{ opt.label }}</span>
              <span class="radio-sub">{{ opt.sub }}</span>
            </span>
          </label>
        </fieldset>
      </section>

      <div class="actions">
        <button
          type="submit"
          class="save-btn"
          data-testid="settings-save"
          :disabled="!dirty"
        >
          <i class="pi pi-check" aria-hidden="true" />
          <span>Save preferences</span>
        </button>
        <span
          v-if="savedFlash"
          class="saved-flash"
          data-testid="settings-saved"
        >
          <i class="pi pi-check-circle" aria-hidden="true" />
          Saved.
        </span>
      </div>
    </form>

    <section class="danger" data-testid="settings-danger">
      <h2 class="card-title danger-title">
        <i class="pi pi-exclamation-triangle card-icon" aria-hidden="true" />
        Danger zone
      </h2>
      <p class="danger-text">
        Reset removes your local profile and runs onboarding again. Sessions on the server stay put.
      </p>
      <router-link
        to="/onboarding?retake=1"
        class="danger-link"
        data-testid="settings-retake-onboarding"
      >
        <span>Retake onboarding</span>
        <i class="pi pi-arrow-right" aria-hidden="true" />
      </router-link>
    </section>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

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
  max-width: 42rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
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
  gap: 1rem;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-paper);
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
}

.card-icon {
  font-size: 1rem;
  color: var(--color-accent);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lbl {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
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

.input {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
  color: var(--color-heading);
  font-family: var(--font-sans);
  font-size: 1rem;
  transition: border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease;
}

.input::placeholder {
  color: var(--color-text-faint);
}

.input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 4px var(--color-accent-ring);
}

.hint {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
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

/* Actions */
.actions {
  display: inline-flex;
  align-items: center;
  gap: 0.875rem;
  flex-wrap: wrap;
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce), box-shadow var(--motion-fast) ease, opacity var(--motion-fast) ease;
}

.save-btn:hover:not(:disabled) { transform: translateY(-2px); }

.save-btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: var(--shadow-pop-pressed);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.saved-flash {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--signal-success);
}

/* Danger zone */
.danger {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 1.5rem;
  border: 1px dashed var(--signal-error);
  border-radius: var(--radius-card);
  background: rgba(239, 68, 68, 0.04);
}

.danger-title {
  color: var(--signal-error);
}

.danger .card-icon {
  color: var(--signal-error);
}

.danger-text {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}

.danger-link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--signal-error);
  border: 1px solid var(--signal-error);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  text-decoration: none;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.danger-link:hover {
  background: var(--signal-error);
  color: #FFFFFF;
  transform: translateY(-1px);
}
</style>

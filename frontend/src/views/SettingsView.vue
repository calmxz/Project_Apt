<template>
  <section class="settings" data-testid="settings">
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
        <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
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

    <section class="card" data-testid="settings-appearance">
      <h2 class="card-title">
        <i class="pi pi-moon card-icon" aria-hidden="true" />
        Appearance
      </h2>
      <div class="switch-row">
        <span class="switch-body">
          <span class="switch-label">Dark mode</span>
          <span class="switch-sub">Use a dark theme across the app.</span>
        </span>
        <button
          type="button"
          class="switch"
          :class="{ 'switch--on': isDark }"
          role="switch"
          :aria-checked="isDark"
          aria-label="Dark mode"
          data-testid="settings-theme-toggle"
          @click="toggleTheme"
        >
          <span class="switch-knob" aria-hidden="true" />
        </button>
      </div>
    </section>

    <section
      v-if="authStore.isAuthenticated"
      class="signout"
      data-testid="settings-signout-section"
    >
      <button
        type="button"
        class="signout-btn"
        data-testid="settings-sign-out"
        @click="signOut"
      >
        <i class="pi pi-sign-out" aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </section>

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
import { useRouter } from 'vue-router'

import FeedbackStylePicker from '../components/FeedbackStylePicker.vue'
import { useUserStore } from '../stores/user.js'
import { useAuthStore } from '../stores/auth.js'
import { useTheme } from '../composables/useTheme.js'
import { useToast } from '../composables/useToast.js'

const user = useUserStore()
const authStore = useAuthStore()
const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()
const { showSuccess, showError } = useToast()

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

async function signOut() {
  try {
    await authStore.signOut()
  } catch (err) {
    showError(err?.message || 'Sign out failed')
    return
  }
  router.push('/login')
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
  color: var(--color-accent-text);
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
  color: var(--color-accent-text);
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
  background: var(--color-accent-strong);
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
  color: var(--color-success-text);
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
  color: var(--color-error-text);
}

.danger .card-icon {
  color: var(--color-error-text);
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
  color: var(--color-error-text);
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

/* Appearance switch */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.switch-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.switch-label {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.switch-sub {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.switch {
  position: relative;
  flex-shrink: 0;
  width: 2.75rem;
  height: 1.5rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-strong);
  background: var(--color-border-strong);
  cursor: pointer;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.switch--on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.switch:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.switch-knob {
  position: absolute;
  top: 50%;
  left: 0.1875rem;
  width: 1.125rem;
  height: 1.125rem;
  transform: translateY(-50%);
  border-radius: var(--radius-pill);
  background: #FFFFFF;
  box-shadow: var(--shadow-paper);
  transition: left var(--motion-fast) var(--motion-bounce);
}

.switch--on .switch-knob {
  left: calc(100% - 1.3125rem);
}

/* Sign out */
.signout {
  display: flex;
}

.signout-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-strong);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.signout-btn:hover {
  color: var(--color-heading);
  border-color: var(--color-text-muted);
  transform: translateY(-1px);
}

.signout-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

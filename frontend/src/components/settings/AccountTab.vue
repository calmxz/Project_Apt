<template>
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

    <div class="actions">
      <button
        type="submit"
        class="save-btn"
        data-testid="settings-save"
        :disabled="!dirty || saving"
      >
        <i class="pi pi-check" aria-hidden="true" />
        <span>Save name</span>
      </button>
      <span v-if="savedFlash" class="saved-flash" data-testid="settings-saved">
        <i class="pi pi-check-circle" aria-hidden="true" />
        Saved.
      </span>
    </div>

    <p v-if="saveError" class="error" role="alert" data-testid="settings-error">
      {{ saveError }}
    </p>
  </form>

  <section v-if="authStore.isAuthenticated" class="card" data-testid="settings-security">
    <h2 class="card-title">
      <i class="pi pi-lock card-icon" aria-hidden="true" />
      Security
    </h2>
    <form class="pw-form" @submit.prevent="changePassword">
      <div class="field">
        <label class="lbl" for="pw-current">Current password</label>
        <input
          id="pw-current"
          v-model="pwCurrent"
          data-testid="settings-pw-current"
          class="input"
          type="password"
          autocomplete="current-password"
        />
      </div>
      <div class="field">
        <label class="lbl" for="pw-new">New password</label>
        <input
          id="pw-new"
          v-model="pwNew"
          data-testid="settings-pw-new"
          class="input"
          type="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
        />
      </div>
      <div class="field">
        <label class="lbl" for="pw-confirm">Confirm new password</label>
        <input
          id="pw-confirm"
          v-model="pwConfirm"
          data-testid="settings-pw-confirm"
          class="input"
          type="password"
          autocomplete="new-password"
        />
      </div>
      <p v-if="pwMismatch" class="hint" data-testid="settings-pw-mismatch">
        New passwords do not match.
      </p>
      <p v-if="pwError" class="pw-error" role="alert" data-testid="settings-pw-error">
        {{ pwError }}
      </p>
      <p v-if="pwSuccess" class="saved-flash" role="status" data-testid="settings-pw-success">
        <i class="pi pi-check-circle" aria-hidden="true" />
        Password updated.
      </p>
      <div class="actions">
        <button
          type="button"
          class="save-btn"
          data-testid="settings-pw-submit"
          :disabled="!pwCanSubmit || pwSubmitting"
          @click="changePassword"
        >
          <i class="pi pi-lock" aria-hidden="true" />
          <span>{{ pwSubmitting ? 'Updating…' : 'Update password' }}</span>
        </button>
      </div>
    </form>
  </section>

  <section v-if="authStore.isAuthenticated" class="signout" data-testid="settings-signout-section">
    <button type="button" class="signout-btn" data-testid="settings-sign-out" @click="signOut">
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
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { friendlyError } from '@/lib/errors.js'
import { useUserStore } from '../../stores/user.js'
import { useAuthStore } from '../../stores/auth.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const authStore = useAuthStore()
const router = useRouter()
const { showSuccess, showError } = useToast()

const displayName = ref(user.name || '')
const savedFlash = ref(false)
const saving = ref(false)
const saveError = ref(null)

const dirty = computed(() => (displayName.value || '').trim() !== (user.name || ''))

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  saveError.value = null
  try {
    await user.updateProfile({
      name: displayName.value,
      feedback: user.interactionPreferences?.feedback || 'hints',
    })
    savedFlash.value = true
    showSuccess('Name saved.')
  } catch (e) {
    // F-11: inline surface (LoginView pattern); the errorBus toast alone
    // left the form frozen with no explanation and an unhandled rejection.
    saveError.value = friendlyError(e)
  } finally {
    saving.value = false
  }
}

watch(displayName, () => {
  savedFlash.value = false
})

const pwCurrent = ref('')
const pwNew = ref('')
const pwConfirm = ref('')
const pwError = ref('')
const pwSuccess = ref(false)
const pwSubmitting = ref(false)

const pwMismatch = computed(() => pwConfirm.value.length > 0 && pwConfirm.value !== pwNew.value)
const pwCanSubmit = computed(
  () => pwCurrent.value.length > 0 && pwNew.value.length >= 8 && pwNew.value === pwConfirm.value,
)

async function changePassword() {
  if (!pwCanSubmit.value) return
  pwError.value = ''
  pwSuccess.value = false
  pwSubmitting.value = true
  try {
    await authStore.signIn(authStore.userEmail, pwCurrent.value)
  } catch {
    pwError.value = 'Current password is incorrect.'
    pwSubmitting.value = false
    return
  }
  try {
    await authStore.updatePassword(pwNew.value)
    pwCurrent.value = ''
    pwNew.value = ''
    pwConfirm.value = ''
    pwSuccess.value = true
    showSuccess('Password updated.')
  } catch (e) {
    pwError.value = e?.message || 'Could not update password. Try again.'
  } finally {
    pwSubmitting.value = false
  }
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
  transition:
    border-color var(--motion-fast) ease,
    box-shadow var(--motion-fast) ease;
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
  color: #ffffff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  transition:
    filter var(--motion-fast) ease,
    opacity var(--motion-fast) ease;
}

.save-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.save-btn:active:not(:disabled) {
  filter: brightness(0.95);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.875rem;
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
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease,
    transform var(--motion-fast) var(--motion-bounce);
}

.danger-link:hover {
  background: var(--signal-error);
  color: #ffffff;
  transform: translateY(-1px);
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
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease,
    border-color var(--motion-fast) ease,
    transform var(--motion-fast) var(--motion-bounce);
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

.pw-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pw-error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.875rem;
}
</style>

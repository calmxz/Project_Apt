<template>
  <div class="account" data-testid="settings-account">
    <form class="form" @submit.prevent="save">
      <section class="sec">
        <h2 class="sec-title">Account</h2>
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

      <div class="btn-fill-row">
        <button
          type="submit"
          class="btn-fill"
          :class="{ 'btn-fill--busy': saving }"
          data-testid="settings-save"
          :disabled="!dirty || saving"
        >
          Save name
        </button>
        <span v-if="savedFlash" class="saved-flash" data-testid="settings-saved">
          <svg
            class="tick"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 6.5 L4.8 9.2 L10 3.2" />
          </svg>
          Saved.
        </span>
      </div>

      <p v-if="saveError" class="error" role="alert" data-testid="settings-error">
        {{ saveError }}
      </p>
    </form>

    <section v-if="authStore.isAuthenticated" class="sec" data-testid="settings-security">
      <h2 class="sec-title">Security</h2>
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
        <p v-if="pwError" class="error" role="alert" data-testid="settings-pw-error">
          {{ pwError }}
        </p>
        <div class="btn-fill-row">
          <button
            type="submit"
            class="btn-fill"
            :class="{ 'btn-fill--busy': pwSubmitting }"
            data-testid="settings-pw-submit"
            :disabled="!pwCanSubmit || pwSubmitting"
          >
            {{ pwSubmitting ? 'Updating…' : 'Update password' }}
          </button>
          <span
            v-if="pwSuccess"
            class="saved-flash"
            role="status"
            data-testid="settings-pw-success"
          >
            <svg
              class="tick"
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 6.5 L4.8 9.2 L10 3.2" />
            </svg>
            Password updated.
          </span>
        </div>
      </form>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import { friendlyError } from '@/lib/errors.js'
import { useUserStore } from '../../stores/user.js'
import { useAuthStore } from '../../stores/auth.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const authStore = useAuthStore()
const { showSuccess } = useToast()

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
</script>

<style scoped>
/* Account is a ruled page: sections divided by one hairline and fields written
   on a rule. The two submits are the one filled control on the page (.btn-fill,
   base.css), each on its own row beside its saved caption. No card, no glyph
   font. */
.account {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--line-pitch);
  width: 100%;
}

.form {
  display: flex;
  flex-direction: column;
}

/* Card shell, .sec-title, .saved-flash and .tick come from SettingsView's
   .panel; only this tab's own alignment is declared here. */
.sec {
  align-items: flex-start;
  gap: 0.5rem;
}

.field {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 28rem;
}

.lbl {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

/* Field on a rule: no box, one bottom rule that inks up on focus. */
.input {
  width: 100%;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  border-radius: 0;
  background: transparent;
  color: var(--ink-learner);
  caret-color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: calc(var(--line-pitch) - 1px);
}

.input::placeholder {
  color: var(--pencil);
}

.input:focus {
  outline: none;
  border-bottom-color: var(--ink-learner);
}

.hint {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

.pw-form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
}

/* From 60rem the form and the security card sit side by side. */
@media (min-width: 60rem) {
  .account {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>

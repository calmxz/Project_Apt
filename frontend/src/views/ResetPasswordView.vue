<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">reset password</span>
      <h1 class="title">Set a new password</h1>
      <p class="lede">Choose a new password for your account.</p>
    </header>

    <form class="form" data-testid="reset-form" @submit.prevent="submit">
      <div class="field">
        <label for="password" class="label">New password</label>
        <InputText
          id="password"
          v-model="password"
          type="password"
          data-testid="reset-password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          required
          class="input"
        />
      </div>

      <div class="field">
        <label for="confirm" class="label">Confirm new password</label>
        <InputText
          id="confirm"
          v-model="confirm"
          type="password"
          data-testid="reset-confirm"
          autocomplete="new-password"
          placeholder="Re-enter password"
          required
          class="input"
        />
      </div>

      <p v-if="mismatch" class="hint" data-testid="reset-mismatch">Passwords do not match.</p>
      <p v-if="error" class="error" data-testid="reset-error">{{ error }}</p>
      <p v-if="error" class="swap">
        Link expired?
        <RouterLink to="/forgot" data-testid="reset-to-forgot">Request a new one</RouterLink>
      </p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="reset-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Updating…' : 'Update password' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
const router = useRouter()

const password = ref('')
const confirm = ref('')
const submitting = ref(false)
const error = ref('')

const passwordValid = computed(() => password.value.length >= 8)
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)
const canSubmit = computed(() => passwordValid.value && confirm.value === password.value)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.updatePassword(password.value)
    await auth.signOut()
    router.push('/login?reset=1')
  } catch (e) {
    error.value = e?.message || 'Could not update password. The link may have expired.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login {
  max-width: 30rem;
  margin: 0 auto;
  padding: 2rem 0;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
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
  font-size: clamp(1.875rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  margin: 0;
  color: var(--color-heading);
}

.lede {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-muted);
  max-width: 24rem;
  line-height: var(--lh-body);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lift);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.input :deep(input),
.input.p-inputtext {
  font-family: var(--font-sans);
  font-size: 1rem;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.7rem 1.1rem;
  width: 100%;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #fff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  transition: filter var(--motion-fast) ease;
}

.cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.cta:not(:disabled):hover {
  filter: brightness(1.08);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.875rem;
}

.hint {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.sent {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--color-success-text);
  line-height: var(--lh-body);
}

.swap {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-align: center;
}
</style>

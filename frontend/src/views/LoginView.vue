<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">sign in</span>
      <h1 class="title">Welcome to AdaptLearn</h1>
      <p class="lede">Sign in with your email and password.</p>
    </header>

    <form class="form" data-testid="login-form" @submit.prevent="submit">
      <div class="field">
        <label for="email" class="label">Email</label>
        <InputText
          id="email"
          v-model="email"
          type="email"
          data-testid="login-email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          class="input"
        />
      </div>

      <div class="field">
        <label for="password" class="label">Password</label>
        <InputText
          id="password"
          v-model="password"
          type="password"
          data-testid="login-password"
          autocomplete="current-password"
          placeholder="Your password"
          required
          class="input"
        />
      </div>

      <p v-if="error" class="error" data-testid="login-error">{{ error }}</p>
      <p v-if="needsConfirm" class="hint">
        <button
          type="button"
          class="linkbtn"
          data-testid="login-resend"
          @click="resend"
        >
          Resend confirmation email
        </button>
      </p>
      <p v-if="resent" class="sent" data-testid="login-resent">
        Confirmation email re-sent to <strong>{{ email.trim() }}</strong>.
      </p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="login-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Signing in…' : 'Sign in' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>

      <p class="swap">
        New here?
        <RouterLink to="/register" data-testid="login-to-register">Create an account</RouterLink>
      </p>
    </form>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const error = ref('')
const needsConfirm = ref(false)
const resent = ref(false)

const canSubmit = computed(
  () =>
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()) &&
    password.value.length > 0,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  needsConfirm.value = false
  resent.value = false
  submitting.value = true
  try {
    await auth.signIn(email.value.trim(), password.value)
  } catch (e) {
    const msg = e?.message || 'Could not sign in. Try again.'
    error.value = msg
    if (/not confirmed/i.test(msg)) needsConfirm.value = true
  } finally {
    submitting.value = false
  }
}

async function resend() {
  resent.value = false
  try {
    await auth.resendConfirmation(email.value.trim())
    resent.value = true
  } catch (e) {
    error.value = e?.message || 'Could not resend. Try again.'
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
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.cta:not(:disabled):hover {
  transform: translateY(-1px);
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

.sent {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-success-text);
}

.hint {
  margin: 0;
  font-size: 0.875rem;
}

.linkbtn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--color-accent-text);
  cursor: pointer;
  text-decoration: underline;
}

.swap {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-align: center;
}
</style>

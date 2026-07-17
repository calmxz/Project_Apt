<template>
  <section class="login">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">reset password</span>
      <h1 class="title">Forgot your password?</h1>
      <p class="lede">Enter your email and we'll send you a reset link.</p>
    </header>

    <form v-if="!sent" class="form" data-testid="forgot-form" @submit.prevent="submit">
      <div class="field">
        <label for="email" class="label">Email</label>
        <InputText
          id="email"
          v-model="email"
          type="email"
          data-testid="forgot-email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          class="input"
        />
      </div>

      <p v-if="error" class="error" data-testid="forgot-error">{{ error }}</p>

      <div class="actions">
        <button
          type="submit"
          class="cta"
          data-testid="forgot-submit"
          :disabled="!canSubmit || submitting"
        >
          <span>{{ submitting ? 'Sending…' : 'Send reset link' }}</span>
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
      </div>

      <p class="swap">
        Remembered it?
        <RouterLink to="/login" data-testid="forgot-to-login">Back to sign in</RouterLink>
      </p>
    </form>

    <div v-else class="form" data-testid="forgot-sent">
      <p class="sent">
        If an account exists for <strong>{{ email.trim() }}</strong>, a password
        reset link is on its way. Check your inbox.
      </p>
      <p class="swap">
        <RouterLink to="/login" data-testid="forgot-sent-to-login">Back to sign in</RouterLink>
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()

const email = ref('')
const submitting = ref(false)
const error = ref('')
const sent = ref(false)

const canSubmit = computed(() => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()))

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.requestPasswordReset(email.value.trim())
    sent.value = true
  } catch (e) {
    error.value = e?.message || 'Could not send reset link. Try again.'
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

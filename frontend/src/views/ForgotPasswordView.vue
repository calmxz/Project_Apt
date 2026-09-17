<template>
  <main class="cover">
    <div class="sheet">
      <header class="cover-head">
        <Logo size="md" variant="full" />
        <h1 class="cover-title">Forgot your password?</h1>
        <p class="cover-lede">Enter your email and we'll send you a reset link.</p>
      </header>

      <form v-if="!sent" class="form" data-testid="forgot-form" @submit.prevent="submit">
        <div class="field">
          <label for="email" class="field-label">Email</label>
          <div class="field-line">
            <InputText
              id="email"
              v-model="email"
              type="email"
              data-testid="forgot-email"
              autocomplete="email"
              placeholder="you@example.com"
              required
              class="field-input"
            />
          </div>
        </div>

        <p v-if="error" class="status is-alert" role="alert" data-testid="forgot-error">
          {{ error }}
        </p>

        <div class="actions">
          <button
            type="submit"
            class="cta"
            data-testid="forgot-submit"
            :disabled="!canSubmit || submitting"
          >
            <span>{{ submitting ? 'Sending…' : 'Send reset link' }}</span>
            <svg
              class="cta-arrow"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3.5 10 L16.5 10" />
              <path d="M11 4.5 L16.5 10 L11 15.5" />
            </svg>
          </button>
        </div>

        <p class="line">
          Remembered it?
          <RouterLink class="link" to="/login" data-testid="forgot-to-login"
            >Back to sign in</RouterLink
          >
        </p>
      </form>

      <div v-else class="form" data-testid="forgot-sent">
        <p class="status is-done">
          If an account exists for <strong>{{ email.trim() }}</strong
          >, a password reset link is on its way. Check your inbox.
        </p>
        <p class="line">
          <RouterLink class="link" to="/login" data-testid="forgot-sent-to-login"
            >Back to sign in</RouterLink
          >
        </p>
      </div>
    </div>
  </main>
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
/* One white card centred on the desk ground. */
.cover {
  min-height: 100dvh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.75rem 1rem 3.5rem;
  background: var(--desk);
}

.sheet {
  width: 100%;
  max-width: 26rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow:
    0 1px 0 var(--card-drop),
    var(--shadow-lift);
  padding: clamp(1.5rem, 4vw, 2.5rem);
}

.cover-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.cover-title {
  margin: 0.875rem 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.cover-lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1.5rem;
}

.field {
  display: flex;
  flex-direction: column;
}

.field-label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: 1.75rem;
  color: var(--pencil);
}

.field-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
  gap: 0.5rem;
  border-bottom: 1px solid var(--card-edge);
  transition: border-color var(--motion-fast) ease;
}

.field-line:focus-within {
  border-bottom-color: var(--ink-learner);
}

.field-input :deep(input),
.field-input.p-inputtext {
  width: 100%;
  height: 1.75rem;
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  outline: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: 1.75rem;
  color: var(--ink-learner);
  caret-color: var(--ink-learner);
}

.field-input :deep(input):focus,
.field-input.p-inputtext:focus {
  box-shadow: none;
  outline: 0;
  border: 0;
}

.field-input :deep(input)::placeholder,
.field-input.p-inputtext::placeholder {
  color: var(--pencil);
  opacity: 1;
}

/* Written, not stamped: the cover's action is a line of blue text with a
   drawn arrow after the word. Filled blue stays in dialog footers. */
.actions {
  display: flex;
}

.cta {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: 1.75rem;
  cursor: pointer;
  transition: color var(--motion-fast) ease;
}

.cta > span {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cta:not(:disabled):hover {
  color: var(--color-accent-hover);
}

.cta:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.cta:disabled {
  color: var(--pencil);
  cursor: default;
}

.cta:disabled > span {
  text-decoration: none;
}

.cta-arrow {
  flex: 0 0 auto;
}

.status {
  margin: 0;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-top: 3px solid var(--color-accent);
  border-radius: 0 0 var(--radius-card) var(--radius-card);
  padding: 0.4rem 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink);
}

.status.is-alert {
  border-top-color: var(--tab-focus);
  color: var(--ink-marker-text);
}

.status.is-done {
  border-top-color: var(--tab-mastered);
}

.line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: 1.75rem;
  color: var(--pencil);
}

.link {
  font-weight: 700;
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link:hover {
  color: var(--color-accent-hover);
}

.link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

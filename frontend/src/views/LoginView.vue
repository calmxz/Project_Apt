<template>
  <main class="cover">
    <div class="sheet">
      <header class="cover-head">
        <Logo size="md" variant="full" />
        <h1 class="cover-title">Welcome to Crux</h1>
        <p class="cover-lede">Sign in with your email and password.</p>
      </header>

      <form class="form" data-testid="login-form" @submit.prevent="submit">
        <p v-if="resetDone" class="status is-done" data-testid="login-reset-done">
          Password updated — sign in with your new password.
        </p>

        <div class="field">
          <label for="email" class="field-label">Email</label>
          <div class="field-line">
            <InputText
              id="email"
              v-model="email"
              type="email"
              data-testid="login-email"
              autocomplete="email"
              placeholder="you@example.com"
              required
              class="field-input"
            />
          </div>
        </div>

        <div class="field">
          <label for="password" class="field-label">Password</label>
          <div class="field-line has-glyph">
            <InputText
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              data-testid="login-password"
              autocomplete="current-password"
              placeholder="Your password"
              required
              class="field-input"
            />
            <button
              type="button"
              class="field-glyph"
              data-testid="login-toggle-password"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <svg
                viewBox="0 0 20 20"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M1.5 10 C4 5.5 6.9 3.5 10 3.5 C13.1 3.5 16 5.5 18.5 10" />
                <path d="M18.5 10 C16 14.5 13.1 16.5 10 16.5 C6.9 16.5 4 14.5 1.5 10" />
                <circle cx="10" cy="10" r="2.75" />
                <path v-if="showPassword" d="M3.5 16.5 L16.5 3.5" />
              </svg>
            </button>
          </div>
        </div>

        <p v-if="error" class="status is-alert" role="alert" data-testid="login-error">
          {{ error }}
        </p>
        <p v-if="needsConfirm" class="line">
          <button type="button" class="linkbtn" data-testid="login-resend" @click="resend">
            Resend confirmation email
          </button>
        </p>
        <p v-if="resent" class="status is-done" data-testid="login-resent">
          Confirmation email re-sent to <strong>{{ email.trim() }}</strong
          >.
        </p>

        <div class="actions">
          <button
            type="submit"
            class="cta hit-44"
            data-testid="login-submit"
            :disabled="!canSubmit || submitting"
          >
            <span>{{ submitting ? 'Signing in…' : 'Sign in' }}</span>
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
          <RouterLink class="link" to="/forgot" data-testid="login-to-forgot"
            >Forgot password?</RouterLink
          >
        </p>
        <p class="line">
          New here?
          <RouterLink class="link" to="/register" data-testid="login-to-register"
            >Create an account</RouterLink
          >
        </p>
      </form>
    </div>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { useAuthStore } from '../stores/auth.js'
import { safeRedirect } from '../utils/safeRedirect.js'

const route = useRoute()
const router = useRouter()
const resetDone = computed(() => route.query.reset === '1')

const auth = useAuthStore()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const error = ref('')
const needsConfirm = ref(false)
const resent = ref(false)

const canSubmit = computed(
  () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim()) && password.value.length > 0,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  needsConfirm.value = false
  resent.value = false
  submitting.value = true
  try {
    await auth.signIn(email.value.trim(), password.value)
    // signInWithPassword updates the store reactively, but the router guard
    // only redirects on navigation. Push explicitly so the user lands on home
    // without needing a manual refresh; the guard then bounces to onboarding
    // if it is still incomplete.
    // F-49: honor a deep-link redirect the guard attached to /login, guarded
    // against open-redirect via safeRedirect.
    const target = safeRedirect(route.query.redirect)
    await (target ? router.push(target) : router.push({ name: 'home' }))
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

/* A field is a label above a line the learner writes on. */
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

.field-line.has-glyph {
  grid-template-columns: minmax(0, 1fr) auto;
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

/* A drawn glyph in the learner's ink at the end of the line, not a glyph font. */
.field-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 1.75rem;
  flex-shrink: 0;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--ink-learner);
  cursor: pointer;
  transition: color var(--motion-fast) ease;
}

.field-glyph:hover {
  color: var(--color-accent-hover);
}

.field-glyph:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
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

/* A small status card: card stock with a token-colored border. */
.status {
  margin: 0;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink);
}

.status.is-alert {
  border-color: var(--tab-focus);
  color: var(--ink-marker-text);
}

.status.is-done {
  border-color: var(--tab-mastered);
}

.line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: 1.75rem;
  color: var(--pencil);
}

.link,
.linkbtn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  font-weight: 700;
  color: var(--ink-learner);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link:hover,
.linkbtn:hover {
  color: var(--color-accent-hover);
}

.link:focus-visible,
.linkbtn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

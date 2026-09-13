<template>
  <section class="cover">
    <div class="sheet">
      <header class="cover-head">
        <Logo size="md" variant="full" />
        <h1 class="cover-title">Set a new password</h1>
        <p class="cover-lede">
          {{
            hasRecovery
              ? 'Choose a new password for your account.'
              : 'Reset links work once and expire after an hour.'
          }}
        </p>
      </header>

      <form v-if="hasRecovery" class="form" data-testid="reset-form" @submit.prevent="submit">
        <div class="field">
          <label for="password" class="field-label">New password</label>
          <div class="field-line">
            <InputText
              id="password"
              v-model="password"
              type="password"
              data-testid="reset-password"
              autocomplete="new-password"
              placeholder="At least 8 characters"
              required
              class="field-input"
            />
          </div>
        </div>

        <div class="field">
          <label for="confirm" class="field-label">Confirm new password</label>
          <div class="field-line">
            <InputText
              id="confirm"
              v-model="confirm"
              type="password"
              data-testid="reset-confirm"
              autocomplete="new-password"
              placeholder="Re-enter password"
              required
              class="field-input"
            />
          </div>
        </div>

        <p v-if="mismatch" class="field-error" data-testid="reset-mismatch">
          Passwords do not match.
        </p>
        <p v-if="error" class="status is-alert" role="alert" data-testid="reset-error">
          {{ error }}
        </p>
        <p v-if="error" class="line">
          Link expired?
          <RouterLink class="link" to="/forgot" data-testid="reset-to-forgot"
            >Request a new one</RouterLink
          >
        </p>

        <div class="actions">
          <button
            type="submit"
            class="cta"
            data-testid="reset-submit"
            :disabled="!canSubmit || submitting"
          >
            <span>{{ submitting ? 'Updating…' : 'Update password' }}</span>
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
      </form>

      <div v-else class="form" data-testid="reset-no-session">
        <p class="status is-alert" role="alert">This reset link is invalid or has expired.</p>
        <p class="line">
          <RouterLink class="link" to="/forgot" data-testid="reset-to-forgot"
            >Request a new one</RouterLink
          >
        </p>
      </div>
    </div>
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

// Supabase exchanges the recovery hash asynchronously after init(), so the
// hash itself counts as evidence of a valid link; the form must never hide
// while "#...type=recovery" is in the URL.
const recoveryHash = ref(
  typeof window !== 'undefined' && window.location.hash.includes('type=recovery'),
)
const hasRecovery = computed(() => recoveryHash.value || !auth.ready || !!auth.session)

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
/* The notebook cover: one centred sheet on the page ground. No card, no
   shadow -- the fields' rules are the only lines. */
.cover {
  min-height: 100dvh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--line-pitch) 1rem calc(var(--line-pitch) * 2);
  background: var(--color-background);
}

.sheet {
  width: 100%;
  max-width: 26rem;
}

.cover-head {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: calc(var(--line-pitch) - 1px);
  border-bottom: 1px solid var(--rule-strong);
}

.cover-title {
  margin: var(--line-pitch) 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.cover-lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--line-pitch);
  padding-top: var(--line-pitch);
}

/* A field is a label written in pencil above a line the learner writes on. */
.field {
  display: flex;
  flex-direction: column;
}

.field-label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.field-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
  gap: 0.5rem;
  border-bottom: 1px solid var(--rule-strong);
  transition: border-color var(--motion-fast) ease;
}

.field-line:focus-within {
  border-bottom-color: var(--ink-learner);
}

.field-input :deep(input),
.field-input.p-inputtext {
  width: 100%;
  height: var(--line-pitch);
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  outline: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
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
  line-height: var(--line-pitch);
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

/* One line of ink on paper inside a full rule. */
.status {
  margin: 0;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.status.is-alert {
  border-color: var(--ink-marker);
  color: var(--ink-marker-text);
}

.field-error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

.line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
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

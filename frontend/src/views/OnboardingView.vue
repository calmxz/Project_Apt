<template>
  <section class="onboarding">
    <header class="head">
      <Logo size="lg" variant="mark-only" />
      <span class="folio">welcome</span>
      <h1 class="title">Welcome to AdaptLearn.</h1>
      <p class="lede">Tell us how you like to learn — we'll tune the tutor before you begin.</p>
    </header>

    <form class="form" @submit.prevent="submit">
      <div class="field" style="--delay: 0ms">
        <label for="display-name" class="label">What we call you</label>
        <InputText
          id="display-name"
          v-model="displayName"
          data-testid="onboarding-name"
          placeholder="Learner"
          autocomplete="off"
          class="input"
        />
      </div>

      <div class="field" style="--delay: 60ms">
        <span class="label">When you get stuck</span>
        <SelectButton
          v-model="feedback"
          :options="feedbackOptions"
          option-label="label"
          option-value="value"
          data-testid="onboarding-feedback"
          :allow-empty="false"
          class="select"
        />
        <p class="help">
          {{
            feedback === 'hints'
              ? 'Tutor will nudge you toward the answer.'
              : 'Tutor will explain the answer outright when asked.'
          }}
        </p>
      </div>

      <div class="actions" style="--delay: 120ms">
        <button
          type="submit"
          class="cta"
          data-testid="onboarding-submit"
          :disabled="!canSubmit"
        >
          <span>Begin</span>
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
import SelectButton from 'primevue/selectbutton'

import Logo from '../components/Logo.vue'
import { useUserStore } from '../stores/user.js'

const router = useRouter()
const userStore = useUserStore()

const displayName = ref(userStore.name || '')
const feedbackOptions = [
  { label: 'Hints', value: 'hints' },
  { label: 'Direct answers', value: 'direct_answers' },
]
const feedback = ref(userStore.interactionPreferences?.feedback || 'hints')

const canSubmit = computed(() => Boolean(feedback.value))

function submit() {
  if (!canSubmit.value) return
  userStore.completeOnboarding({
    name: displayName.value,
    feedback: feedback.value,
  })
  router.push({ name: 'home' })
}
</script>

<style scoped>
.onboarding {
  max-width: 38rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.625rem;
}

.head :deep(.logo-mark) {
  filter: drop-shadow(0 4px 16px rgba(255, 107, 92, 0.35));
  animation: gentle-spin 8s ease-in-out infinite;
}

@keyframes gentle-spin {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(12deg); }
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
  font-size: clamp(2.25rem, 5vw, 3rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  font-size: 1.0625rem;
  color: var(--color-text-muted);
  max-width: 30rem;
  line-height: var(--lh-body);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  padding: 2rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lift);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  opacity: 0;
  animation: rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  animation-delay: var(--delay, 0ms);
}

.label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.help {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.5rem;
  opacity: 0;
  animation: rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  animation-delay: var(--delay, 0ms);
}

.input :deep(input),
.input.p-inputtext {
  font-family: var(--font-sans);
  font-size: 1.0625rem;
  font-weight: 500;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.75rem 1.25rem;
  color: var(--color-heading);
  width: 100%;
  transition: border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease;
}

.input :deep(input):focus,
.input.p-inputtext:focus {
  border-color: var(--color-accent);
  outline: none;
  box-shadow: 0 0 0 4px var(--color-accent-ring);
}

/* Pill-chip SelectButton */
.select :deep(.p-selectbutton) {
  display: inline-flex;
  gap: 0.5rem;
  background: transparent;
  border: 0;
  padding: 0;
}

.select :deep(.p-togglebutton),
.select :deep(.p-selectbutton .p-button) {
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  padding: 0.625rem 1.25rem;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.select :deep(.p-togglebutton:hover),
.select :deep(.p-selectbutton .p-button:hover) {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}

.select :deep(.p-togglebutton:focus-visible),
.select :deep(.p-selectbutton .p-button:focus-visible) {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.select :deep(.p-togglebutton.p-togglebutton-checked),
.select :deep(.p-selectbutton .p-button.p-highlight) {
  background: var(--color-accent-strong);
  color: #FFFFFF;
  border-color: var(--color-accent);
  box-shadow: var(--shadow-pop);
}

.cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.9rem 1.75rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce), box-shadow var(--motion-fast) ease, opacity var(--motion-fast) ease;
}

.cta:hover:not(:disabled) {
  transform: translateY(-2px);
}

.cta:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: var(--shadow-pop-pressed);
}

.cta:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.cta:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

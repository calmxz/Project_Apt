<template>
  <section class="onboarding">
    <div class="meta">
      <span class="folio">chapter 01</span>
      <hr class="hairline" />
    </div>
    <header class="head">
      <h1 class="title">
        Welcome to <em>AdaptLearn</em>.
      </h1>
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
        <Button
          label="Begin"
          icon="pi pi-arrow-right"
          icon-pos="right"
          data-testid="onboarding-submit"
          :disabled="!canSubmit"
          class="cta"
          @click="submit"
        />
      </div>
    </form>

    <footer class="foot">
      <hr class="hairline" />
      <span class="folio">page 01</span>
    </footer>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'

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
  max-width: 36rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.meta,
.foot {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.foot {
  justify-content: flex-end;
}

.meta .hairline,
.foot .hairline {
  flex: 1;
  background: var(--color-border);
}

.folio {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.title {
  font-family: var(--font-serif);
  font-size: var(--fs-display);
  font-weight: 400;
  font-variation-settings: 'opsz' 144;
  line-height: var(--lh-display);
  letter-spacing: var(--tracking-display);
  color: var(--color-heading);
}

.title em {
  font-style: italic;
  font-weight: 500;
  color: var(--color-accent);
}

.lede {
  font-size: 1.0625rem;
  color: var(--color-text-muted);
  max-width: 32rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
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
  font-weight: 500;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.help {
  margin: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
  font-style: italic;
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
  font-family: var(--font-serif);
  font-size: 1.125rem;
  font-weight: 400;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--color-border-strong);
  border-radius: 0;
  padding: 0.5rem 0.25rem;
  color: var(--color-heading);
  width: 100%;
  transition: border-color 180ms ease;
}

.input :deep(input):focus,
.input.p-inputtext:focus {
  border-bottom-color: var(--color-accent);
  outline: none;
  box-shadow: none;
}

.select :deep(.p-togglebutton),
.select :deep(.p-selectbutton .p-button) {
  background: transparent;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 0.625rem 1.25rem;
  transition: all 180ms ease;
}

.select :deep(.p-togglebutton.p-togglebutton-checked),
.select :deep(.p-selectbutton .p-button.p-highlight) {
  background: var(--color-accent);
  color: var(--ink-50);
  border-color: var(--color-accent);
}

.cta :deep(.p-button),
.cta.p-button {
  background: var(--color-heading);
  color: var(--color-background);
  border: 1px solid var(--color-heading);
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 0.75rem 1.75rem;
  border-radius: var(--radius-sm);
  transition: background 180ms ease, transform 180ms ease;
}

.cta :deep(.p-button):not(:disabled):hover,
.cta.p-button:not(:disabled):hover {
  background: var(--color-accent);
  border-color: var(--color-accent);
  transform: translateX(2px);
}

.cta :deep(.p-button):disabled,
.cta.p-button:disabled {
  opacity: 0.4;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

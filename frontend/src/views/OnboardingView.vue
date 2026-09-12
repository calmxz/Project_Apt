<template>
  <section class="cover">
    <div class="sheet">
      <header class="cover-head">
        <Logo size="md" variant="full" />
        <h1 class="cover-title">Welcome to Crux.</h1>
        <p class="cover-lede">
          Tell us how you like to learn — we'll tune the tutor before you begin.
        </p>
      </header>

      <form class="form" @submit.prevent="submit">
        <div class="field stagger" style="--delay: 0ms">
          <label for="display-name" class="field-label">What we call you</label>
          <div class="field-line">
            <InputText
              id="display-name"
              v-model="displayName"
              data-testid="onboarding-name"
              placeholder="Learner"
              autocomplete="off"
              class="field-input"
            />
          </div>
        </div>

        <div class="field stagger" style="--delay: 60ms">
          <fieldset class="choice" data-testid="onboarding-feedback">
            <legend class="field-label">When you get stuck</legend>
            <label
              v-for="(opt, i) in feedbackOptions"
              :key="opt.value"
              class="choice-line"
              :class="{ 'is-selected': feedback === opt.value }"
            >
              <input
                type="radio"
                name="feedback-style"
                class="choice-input"
                :value="opt.value"
                :checked="feedback === opt.value"
                :data-testid="`feedback-style-${opt.value}`"
                @change="feedback = opt.value"
              />
              <span class="choice-letter" aria-hidden="true">{{ letters[i] }}.</span>
              <span class="choice-label">{{ opt.label }}</span>
              <svg
                v-if="feedback === opt.value"
                class="choice-tick"
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
                <path d="M3.5 10.5 L8 15 L16.5 5" />
              </svg>
            </label>
          </fieldset>
          <p class="help">
            {{
              feedback === 'hints'
                ? 'Tutor will nudge you toward the answer.'
                : 'Tutor will explain the answer outright when asked.'
            }}
          </p>
        </div>

        <div class="actions stagger" style="--delay: 120ms">
          <button
            type="submit"
            class="cta"
            data-testid="onboarding-submit"
            :disabled="!canSubmit || submitting"
          >
            <span>Begin</span>
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

        <p v-if="submitError" class="status is-alert" role="alert" data-testid="onboarding-error">
          {{ submitError }}
        </p>
      </form>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import InputText from 'primevue/inputtext'

import Logo from '../components/Logo.vue'
import { friendlyError } from '@/lib/errors.js'
import { useUserStore } from '../stores/user.js'

const router = useRouter()
const userStore = useUserStore()

const displayName = ref(userStore.name || '')
const feedbackOptions = [
  { label: 'Hints', value: 'hints' },
  { label: 'Direct answers', value: 'direct_answers' },
]
const letters = ['A', 'B']
const feedback = ref(userStore.interactionPreferences?.feedback || 'hints')

const canSubmit = computed(() => Boolean(feedback.value))

const submitting = ref(false)
const submitError = ref(null)

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  submitError.value = null
  try {
    await userStore.completeOnboarding({
      name: displayName.value,
      feedback: feedback.value,
    })
    router.push({ name: 'home' })
  } catch (e) {
    // F-11: inline surface (LoginView pattern); the errorBus toast alone
    // left the form frozen with no explanation and an unhandled rejection.
    submitError.value = friendlyError(e)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* The inside cover: the same centred sheet as the auth covers, with the two
   feedback styles written out as lettered lines on the rules. */
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

.field {
  display: flex;
  flex-direction: column;
}

.field-label {
  display: block;
  padding: 0;
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

/* Two lettered lines on the rules; the rule is painted so each line stays a
   whole pitch tall. */
.choice {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.choice-line {
  position: relative;
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  height: var(--line-pitch);
  box-shadow: inset 0 -1px 0 var(--rule);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.choice-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.choice-letter {
  font-weight: 700;
  color: var(--ink-learner);
}

.choice-line.is-selected .choice-label {
  font-weight: 700;
}

.choice-line:hover .choice-label {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.choice-line:has(.choice-input:focus-visible) {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* A drawn tick in the learner's ink, not a glyph font. */
.choice-tick {
  flex: 0 0 auto;
  color: var(--ink-learner);
}

.choice-tick path {
  stroke-dasharray: 26;
  stroke-dashoffset: 26;
  animation: tick-draw var(--motion-base) ease forwards;
}

@keyframes tick-draw {
  to {
    stroke-dashoffset: 0;
  }
}

.help {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.actions {
  display: flex;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--color-accent-strong);
  color: var(--color-text-on-accent);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 600;
  line-height: var(--line-pitch);
  cursor: pointer;
  transition: background var(--motion-fast) ease;
}

.cta:not(:disabled):hover {
  background: var(--color-accent-hover);
}

.cta:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.cta:disabled {
  background: var(--color-surface-soft);
  color: var(--pencil);
  cursor: not-allowed;
}

.cta-arrow {
  flex: 0 0 auto;
}

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

/* Ink appears: the sheet fills in line by line, nothing moves. */
.stagger {
  opacity: 0;
  animation: ink-in var(--motion-ink) var(--motion-bounce) forwards;
  animation-delay: var(--delay, 0ms);
}

@keyframes ink-in {
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stagger {
    opacity: 1;
    animation: none;
  }

  .choice-tick path {
    stroke-dashoffset: 0;
    animation: none;
  }
}
</style>

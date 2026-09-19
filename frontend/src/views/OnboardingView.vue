<template>
  <AuthCover
    title="Welcome to Crux."
    lede="Tell us how you like to learn — we'll tune the tutor before you begin."
  >
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
        <div class="choice" data-testid="onboarding-feedback">
          <p class="field-label">When you get stuck</p>
          <FeedbackStylePicker
            v-model="feedback"
            :options="feedbackOptions"
            name="feedback-style"
          />
        </div>
        <p class="help">
          {{
            feedback === 'hints'
              ? 'Tutor will nudge you toward the answer.'
              : 'Tutor will explain the answer outright when asked.'
          }}
        </p>
      </div>

      <div class="actions stagger" style="--delay: 120ms">
        <button type="submit" class="cta" data-testid="onboarding-submit" :disabled="submitting">
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
  </AuthCover>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import InputText from 'primevue/inputtext'

import AuthCover from '../components/auth/AuthCover.vue'
import FeedbackStylePicker from '../components/FeedbackStylePicker.vue'
import { friendlyError } from '@/lib/errors.js'
import { useUserStore } from '../stores/user.js'

const router = useRouter()
const userStore = useUserStore()

const displayName = ref(userStore.name || '')
const feedbackOptions = [
  { label: 'Hints', value: 'hints' },
  { label: 'Direct answers', value: 'direct_answers' },
]
const feedback = ref(userStore.interactionPreferences?.feedback || 'hints')

const submitting = ref(false)
const submitError = ref(null)

async function submit() {
  if (submitting.value) return
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
/* The picker's own label sits as a paragraph rather than a <label>, so it
   needs the block box the cover's <label> elements already have. */
.field-label {
  display: block;
  padding: 0;
}

/* The lettered lines come from the shared FeedbackStylePicker, so the
   grammar has one source; this wrapper only carries the pencil label. */
.choice {
  min-width: 0;
}

.choice .field-label {
  margin: 0;
}

.help {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

/* Ink appears: the sheet fills in line by line, nothing moves. */
.stagger {
  opacity: 0;
  animation: ink-in var(--motion-ink) var(--motion-out-expo) forwards;
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
}
</style>

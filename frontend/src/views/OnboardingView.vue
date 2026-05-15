<template>
  <section class="onboarding">
    <Card>
      <template #title>Welcome to AdaptLearn</template>
      <template #subtitle>Tell us how you like to learn</template>
      <template #content>
        <div class="form">
          <div class="field">
            <label for="display-name">What should we call you?</label>
            <InputText
              id="display-name"
              v-model="displayName"
              data-testid="onboarding-name"
              placeholder="Learner"
              autocomplete="off"
            />
          </div>

          <div class="field">
            <label>When you get stuck, what helps more?</label>
            <SelectButton
              v-model="feedback"
              :options="feedbackOptions"
              option-label="label"
              option-value="value"
              data-testid="onboarding-feedback"
              :allow-empty="false"
            />
            <p class="help">
              {{
                feedback === 'hints'
                  ? 'Tutor will nudge you toward the answer.'
                  : 'Tutor will explain the answer outright when asked.'
              }}
            </p>
          </div>

          <Button
            label="Get started"
            data-testid="onboarding-submit"
            :disabled="!canSubmit"
            @click="submit"
          />
        </div>
      </template>
    </Card>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import Card from 'primevue/card'
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
  userStore.completeOnboarding({
    name: displayName.value,
    feedback: feedback.value,
  })
  router.push({ name: 'home' })
}
</script>

<style scoped>
.onboarding {
  max-width: 32rem;
  margin: 3rem auto;
  padding: 0 1rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.help {
  margin: 0;
  color: var(--color-text-muted, #888);
  font-size: 0.875rem;
}
</style>

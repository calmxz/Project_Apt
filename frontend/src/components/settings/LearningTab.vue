<template>
  <div class="learning-tab" data-testid="agg-learning">
    <section class="sec feedback-sec" data-testid="learning-feedback">
      <h2 class="sec-title">Feedback style</h2>
      <FeedbackStylePicker v-model="feedback" :options="feedbackOptions" />
      <div class="btn-fill-row">
        <button
          type="button"
          class="btn-fill"
          :class="{ 'btn-fill--busy': savingFeedback }"
          data-testid="learning-feedback-save"
          :disabled="!feedbackDirty || savingFeedback"
          @click="saveFeedback"
        >
          Save feedback style
        </button>
        <span
          v-if="feedbackSaved"
          class="saved-flash"
          role="status"
          data-testid="learning-feedback-saved"
        >
          <svg
            class="tick"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 6.5 L4.8 9.2 L10 3.2" />
          </svg>
          Saved.
        </span>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import FeedbackStylePicker from '../FeedbackStylePicker.vue'
import { friendlyError } from '../../lib/errors.js'
import { useUserStore } from '../../stores/user.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const { showSuccess, showError } = useToast()

const feedbackOptions = [
  { value: 'hints', label: 'Hints', sub: 'Nudge me toward the answer.' },
  { value: 'direct_answers', label: 'Direct answers', sub: 'Explain outright when I ask.' },
]

const feedback = ref(user.interactionPreferences?.feedback || 'hints')
const savingFeedback = ref(false)
const feedbackSaved = ref(false)
const feedbackDirty = computed(
  () => feedback.value !== (user.interactionPreferences?.feedback || 'hints'),
)

// The "Saved." flash reads the same way on every Settings save: it stays
// beside the (now idle) button until the learner changes the value again.
watch(feedback, () => {
  feedbackSaved.value = false
})

async function saveFeedback() {
  if (!feedbackDirty.value || savingFeedback.value) return
  savingFeedback.value = true
  try {
    await user.updateProfile({ name: user.name || '', feedback: feedback.value })
    showSuccess('Preferences saved.')
    feedbackSaved.value = true
  } catch (e) {
    showError(friendlyError(e))
  } finally {
    savingFeedback.value = false
  }
}
</script>

<style scoped>
/* The learning tab holds Feedback style only: the aggregate-profile analytics
   were removed (#350) and belong to the /profile page (#358); the rest of the
   tab's contents come from #357. */
.learning-tab {
  /* Full panel width. Independent sections stacked here and sitting side
     by side from 60rem up. */
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--line-pitch);
}

/* Card shell, .sec-title, .saved-flash and .tick come from assets/sheet.css;
   only this tab's own alignment is declared here. */
.sec {
  align-items: stretch;
  gap: 0.5rem;
}

.btn-fill-row {
  align-self: flex-start;
}

/* From 60rem the cards sit side by side. */
@media (min-width: 60rem) {
  .learning-tab {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .feedback-sec {
    grid-column: 1;
  }
}
</style>

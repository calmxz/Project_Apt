<template>
  <div class="learning-tab" data-testid="agg-learning">
    <section
      v-for="control in controls"
      :key="control.key"
      class="sec"
      :data-testid="`learning-${control.key}`"
    >
      <div class="sec-head">
        <h2 class="sec-title">{{ control.title }}</h2>
        <span
          v-if="control.state.saved"
          class="saved-flash"
          role="status"
          :data-testid="`learning-${control.key}-saved`"
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
      <p v-if="control.help" class="sec-help" :data-testid="`learning-${control.key}-help`">
        {{ control.help }}
      </p>
      <FeedbackStylePicker
        :model-value="control.state.value"
        :options="control.options"
        :legend="control.title"
        :testid-prefix="control.testidPrefix"
        @update:model-value="control.state.change"
      />
    </section>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'

import FeedbackStylePicker from '../FeedbackStylePicker.vue'
import { friendlyError } from '../../lib/errors.js'
import { useUserStore } from '../../stores/user.js'
import { useToast } from '../../composables/useToast.js'

const user = useUserStore()
const { showError } = useToast()

// One autosaving tutor preference (#357). Every change is its own
// single-field PATCH /api/me; changes to one control are queued so they reach
// the server in the order the learner made them and the last choice sticks.
// A failed write puts the control back on the value the store (and so the
// server) still holds.
function autosaved(field, fallback) {
  const stored = () => user.interactionPreferences?.[field] || fallback
  const value = ref(stored())
  const saved = ref(false)
  let queue = Promise.resolve()
  let latest = 0

  function change(next) {
    value.value = next
    saved.value = false
    const seq = ++latest
    queue = queue.then(async () => {
      try {
        await user.updateProfile({ [field]: next })
        if (seq === latest) saved.value = true
      } catch (e) {
        showError(friendlyError(e))
        if (seq === latest) value.value = stored()
      }
    })
  }

  return reactive({ value, saved, change })
}

// Fallbacks match the MeResponse defaults in docs/api/openapi.yaml.
const controls = [
  {
    key: 'feedback',
    title: 'Feedback style',
    testidPrefix: 'feedback-style',
    options: [
      { value: 'hints', label: 'Hints', sub: 'Nudge me toward the answer.' },
      { value: 'direct_answers', label: 'Direct answers', sub: 'Explain outright when I ask.' },
    ],
    state: autosaved('feedback', 'hints'),
  },
  {
    key: 'checkins',
    title: 'Check-ins',
    help: 'How often the tutor runs a quick check without being asked.',
    testidPrefix: 'check-ins',
    options: [
      { value: 'often', label: 'Often' },
      { value: 'sometimes', label: 'Sometimes' },
      { value: 'only_when_asked', label: 'Only when I ask' },
    ],
    state: autosaved('checkIns', 'sometimes'),
  },
  {
    key: 'reply-length',
    title: 'Reply length',
    testidPrefix: 'reply-length',
    options: [
      { value: 'brief', label: 'Brief' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'thorough', label: 'Thorough' },
    ],
    state: autosaved('replyLength', 'balanced'),
  },
]
</script>

<style scoped>
/* The tutor-preferences tab (#357): Feedback style, Check-ins and Reply
   length, each autosaving. The aggregate-profile analytics were removed
   (#350) and belong to the /profile page (#358). */
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

/* The "Saved." flash sits on the title's line, beside it. */
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.sec-help {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

/* From 60rem the cards sit side by side, filling left to right. */
@media (min-width: 60rem) {
  .learning-tab {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>

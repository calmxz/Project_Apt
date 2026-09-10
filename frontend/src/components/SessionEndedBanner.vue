<template>
  <aside class="ended-banner" data-testid="session-ended-banner">
    <p class="line">Session ended {{ formatRelative(endedAt) }}.</p>
    <p v-if="summary" class="summary" data-testid="session-ended-summary">{{ summary }}</p>
    <p class="sub">
      This transcript is kept as-is. Continue the topic in a new session to keep building the
      profile.
    </p>
    <p class="actions">
      <button
        v-if="hasGaps"
        type="button"
        class="resume-btn gaps-btn"
        data-testid="session-resume-gaps"
        :disabled="loading"
        @click="$emit('resume-gaps')"
      >
        Review my gaps
      </button>
      <button
        type="button"
        class="resume-btn"
        data-testid="session-resume"
        :disabled="loading"
        @click="$emit('resume')"
      >
        {{ loading ? 'Resuming…' : 'Resume topic' }}
      </button>
    </p>
  </aside>
</template>

<script setup>
import { formatRelative } from '../utils/formatDate.js'

defineProps({
  endedAt: { type: String, required: true },
  loading: { type: Boolean, default: false },
  hasGaps: { type: Boolean, default: false },
  // topic_profile.last_session_summary, already stripped of the [auto] marker.
  summary: { type: String, default: '' },
})

defineEmits(['resume', 'resume-gaps'])
</script>

<style scoped>
/* The summary strip: the sheet closes under a 1px ink rule. */
.ended-banner {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--ink);
  padding-top: calc(var(--line-pitch) / 2);
  font-family: var(--font-sans);
}

.line {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 600;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.summary {
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.sub {
  margin: 0;
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  margin: 0;
}

.resume-btn {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink-learner);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.resume-btn:disabled {
  color: var(--pencil);
  cursor: not-allowed;
  text-decoration: none;
}

.resume-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

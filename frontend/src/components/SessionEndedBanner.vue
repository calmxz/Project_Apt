<template>
  <aside class="ended-banner" data-testid="session-ended-banner">
    <span class="banner-icon" aria-hidden="true">
      <i class="pi pi-clock" />
    </span>
    <div class="banner-text">
      <p class="line">This session ended {{ formatDate(endedAt) }}.</p>
      <p class="sub">Read-only. Continue the topic in a new session to keep the profile.</p>
    </div>
    <button
      v-if="hasGaps"
      type="button"
      class="resume-btn gaps-btn"
      data-testid="session-resume-gaps"
      :disabled="loading"
      @click="$emit('resume-gaps')"
    >
      <span>Review my gaps</span>
      <i class="pi pi-bullseye" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="resume-btn"
      data-testid="session-resume"
      :disabled="loading"
      @click="$emit('resume')"
    >
      <span>{{ loading ? 'Resuming…' : 'Resume topic' }}</span>
      <i class="pi pi-refresh" aria-hidden="true" />
    </button>
  </aside>
</template>

<script setup>
import { formatDate } from '../utils/formatDate.js'

defineProps({
  endedAt: { type: String, required: true },
  loading: { type: Boolean, default: false },
  hasGaps: { type: Boolean, default: false },
})

defineEmits(['resume', 'resume-gaps'])
</script>

<style scoped>
.ended-banner {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1.125rem;
  background: rgba(255, 176, 32, 0.12);
  border: 1px solid rgba(255, 176, 32, 0.35);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}

.banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  background: var(--signal-warning);
  color: #2A1F00;
  font-size: 1rem;
  flex-shrink: 0;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  flex: 1;
}

.line {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.sub {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.resume-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: var(--signal-warning);
  color: #2A1F00;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  transition: transform var(--motion-fast) var(--motion-bounce), filter var(--motion-fast) ease;
}

.resume-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
}

.resume-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.gaps-btn {
  background: transparent;
  border: 1px solid var(--signal-warning);
  color: var(--color-heading);
}

.gaps-btn:hover:not(:disabled) {
  background: rgba(255, 176, 32, 0.14);
  filter: none;
}
</style>

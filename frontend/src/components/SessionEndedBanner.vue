<template>
  <aside class="ended-banner" data-testid="session-ended-banner">
    <div class="banner-text">
      <span class="folio">archived</span>
      <p class="line">This session ended {{ formatDate(endedAt) }}.</p>
      <p class="sub">Read-only. Continue the topic in a new session to keep the profile.</p>
    </div>
    <Button
      label="Resume topic"
      icon="pi pi-refresh"
      icon-pos="right"
      data-testid="session-resume"
      :loading="loading"
      class="resume-btn"
      @click="$emit('resume')"
    />
  </aside>
</template>

<script setup>
import Button from 'primevue/button'

import { formatDate } from '../utils/formatDate.js'

defineProps({
  endedAt: { type: String, required: true },
  loading: { type: Boolean, default: false },
})

defineEmits(['resume'])
</script>

<style scoped>
.ended-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--color-border-strong);
  border-left: 3px solid var(--color-accent);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-paper);
  flex-wrap: wrap;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.folio {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.line {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  color: var(--color-heading);
}

.sub {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--fs-caption);
}

.resume-btn :deep(.p-button),
.resume-btn.p-button {
  background: var(--color-heading);
  color: var(--color-background);
  border: 1px solid var(--color-heading);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  transition: background 180ms ease;
}

.resume-btn :deep(.p-button):not(:disabled):hover,
.resume-btn.p-button:not(:disabled):hover {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-background);
}
</style>

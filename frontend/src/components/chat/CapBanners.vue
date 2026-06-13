<template>
  <div
    v-if="store.dailyCapReached"
    id="cap-banner-daily"
    class="cap-banner"
    role="alert"
    data-testid="session-cap-banner"
  >
    <strong>Daily limit reached.</strong>
    <span v-if="store.dailyCapInfo">
      {{ store.dailyCapInfo.used }}/{{ store.dailyCapInfo.cap }} requests today.
      Resets at {{ formatShortDateTime(store.dailyCapInfo.resets_at) || 'midnight UTC' }}.
    </span>
  </div>

  <div
    v-if="store.costCapReached"
    id="cap-banner-cost"
    class="cap-banner"
    role="alert"
    data-testid="session-cost-cap-banner"
  >
    <strong>Daily cost limit reached.</strong>
    <span v-if="store.costCapInfo">
      ${{ store.costCapInfo.used_usd }} of ${{ store.costCapInfo.hard_cap_usd }} spent today.
      Resets at {{ formatShortDateTime(store.costCapInfo.resets_at) || 'midnight UTC' }}.
    </span>
  </div>
</template>

<script setup>
import { useSessionStore } from '../../stores/session.js'
import { formatShortDateTime } from '../../utils/formatDate.js'

const store = useSessionStore()
</script>

<style scoped>
/* Cap banner — pill style */
.cap-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.125rem;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  font-size: 0.9375rem;
}

.cap-banner strong {
  color: var(--color-error-text);
  font-weight: 700;
}
</style>

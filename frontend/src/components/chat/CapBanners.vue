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
      {{ store.dailyCapInfo.used }}/{{ store.dailyCapInfo.cap }} requests today. Resets at
      {{ formatShortDateTime(store.dailyCapInfo.resets_at) || 'midnight UTC' }}.
    </span>
  </div>

  <div
    v-if="store.costCapReached"
    id="cap-banner-cost"
    class="cap-banner"
    role="alert"
    data-testid="session-cost-cap-banner"
  >
    <strong v-if="store.costCapInfo?.scope === 'global'">Service daily budget reached.</strong>
    <strong v-else>Daily cost limit reached.</strong>
    <span v-if="store.costCapInfo">
      <template v-if="store.costCapInfo.scope !== 'global'">
        ${{ store.costCapInfo.used_usd }} of ${{ store.costCapInfo.hard_cap_usd }} spent today.
      </template>
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
/* A status caption, not a banner: one line, ink on paper, inside a full rule. */
.cap-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--ink-marker);
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  animation: cap-land var(--motion-ink) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes cap-land {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}

.cap-banner strong {
  color: var(--ink-marker-text);
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .cap-banner {
    animation: none;
  }
}
</style>

<template>
  <div class="usage-tab">
    <div v-if="loading" class="skel" data-testid="usage-tab-loading" aria-hidden="true">
      <span class="skel-block skel-row-tall" />
      <span class="skel-block skel-short" />
    </div>
    <span v-if="loading" class="sr-only" role="status">Loading</span>
    <p v-else-if="error" class="muted" data-testid="usage-error">
      Usage data is unavailable right now.
    </p>
    <UsagePanel v-else-if="usage" :usage="usage" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

import UsagePanel from '../profile/UsagePanel.vue'
import { getUsageSummary } from '../../services/profileApi.js'

const usage = ref(null)
const loading = ref(true)
const error = ref(false)

onMounted(async () => {
  try {
    usage.value = await getUsageSummary()
  } catch (e) {
    error.value = true
    console.error('usage fetch failed', e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.muted {
  color: var(--color-text-muted);
}

.skel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skel-block {
  height: 1.25rem;
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  animation: skel-pulse 1.4s ease-in-out infinite;
}

.skel-row-tall {
  height: 5.5rem;
}

.skel-short {
  width: 55%;
}

@keyframes skel-pulse {
  0%,
  100% {
    opacity: 0.65;
  }
  50% {
    opacity: 0.35;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

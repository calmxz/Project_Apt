<template>
  <div class="usage-tab">
    <div v-if="loading" class="skel" data-testid="usage-tab-loading" aria-hidden="true">
      <span class="skel-block" />
      <span class="skel-block" />
      <span class="skel-block skel-short" />
    </div>
    <span v-if="loading" class="sr-only" role="status">Loading</span>
    <p v-else-if="error" class="error" data-testid="usage-error">
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
/* A failed read is a line of text-safe red on the pitch, not a banner. */
.error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

/* Skeleton: pencil-weight rules on the pitch, no shimmer and no fill. */
.skel {
  display: flex;
  flex-direction: column;
}

.skel-block {
  display: block;
  height: calc(var(--line-pitch) - 1px);
  border-bottom: 1px solid var(--rule-strong);
}

.skel-short {
  width: 55%;
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

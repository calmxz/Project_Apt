<template>
  <div
    v-if="status"
    class="ref-status"
    :class="`is-${status}`"
    role="status"
    aria-live="polite"
    data-testid="reference-status"
  >
    <i :class="iconClass" aria-hidden="true" />
    <span class="ref-text">{{ message }}</span>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { getSessionIngestion } from '../../services/uploadApi.js'

const props = defineProps({
  sessionId: { type: String, required: true },
})

const status = ref(null) // 'pending' | 'ready' | 'failed' | null
const documents = ref([])

let timer = null
let stopped = false
// Bumped on every refresh()/sessionId change so an in-flight poll() whose await
// resolves late cannot clobber a newer session's status (or write post-unmount).
let generation = 0

const readyCount = computed(() => documents.value.filter((d) => d.status === 'ready').length)
const failedCount = computed(() => documents.value.filter((d) => d.status === 'failed').length)
const total = computed(() => documents.value.length)

const message = computed(() => {
  if (status.value === 'pending') {
    return `Indexing ${total.value} reference${total.value === 1 ? '' : 's'}... you can start chatting now.`
  }
  if (status.value === 'failed') {
    return `${failedCount.value} reference${failedCount.value === 1 ? '' : 's'} could not be indexed.`
  }
  if (status.value === 'ready') {
    return `${readyCount.value} reference${readyCount.value === 1 ? '' : 's'} ready.`
  }
  return ''
})

const iconClass = computed(() => {
  if (status.value === 'pending') return 'pi pi-spin pi-spinner'
  if (status.value === 'failed') return 'pi pi-exclamation-triangle'
  if (status.value === 'ready') return 'pi pi-check-circle'
  return ''
})

async function poll(gen) {
  if (stopped || gen !== generation) return
  try {
    const res = await getSessionIngestion(props.sessionId)
    if (stopped || gen !== generation) return
    status.value = res?.status ?? null
    documents.value = res?.documents ?? []
  } catch {
    // Transient; keep the last known state and retry on the next tick.
  }
  if (!stopped && gen === generation && status.value === 'pending') {
    timer = setTimeout(() => poll(gen), 2000)
  }
}

function refresh() {
  generation += 1
  if (timer) clearTimeout(timer)
  poll(generation)
}

watch(() => props.sessionId, refresh)
onMounted(() => poll(generation))
onUnmounted(() => {
  stopped = true
  if (timer) clearTimeout(timer)
})

defineExpose({ refresh })
</script>

<style scoped>
.ref-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
}

.ref-status.is-ready {
  color: var(--color-accent-text);
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
}

.ref-status.is-failed {
  color: var(--color-error-text);
}
</style>

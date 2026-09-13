<template>
  <div v-if="status" class="ref-status" :class="`is-${status}`" data-testid="reference-status">
    <button
      type="button"
      class="ref-header"
      data-testid="ref-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <svg
        v-if="status === 'pending'"
        class="ref-icon ref-spinner spin"
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M17 10 A7 7 0 1 1 10 3" />
      </svg>
      <svg
        v-else-if="status === 'failed'"
        class="ref-icon"
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M10 2.5 L18 17 H2 Z" />
        <path d="M10 8 L10 12" />
        <path d="M10 14.5 L10 14.6" />
      </svg>
      <svg
        v-else-if="status === 'ready'"
        class="ref-icon"
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="10" cy="10" r="7.5" />
        <path d="M6.8 10.2 L9 12.5 L13.2 7.5" />
      </svg>
      <span class="ref-text" role="status" aria-live="polite">{{ message }}</span>
      <svg
        class="ref-icon ref-chevron"
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path v-if="expanded" d="M5 12.5 L10 7.5 L15 12.5" />
        <path v-else d="M5 7.5 L10 12.5 L15 7.5" />
      </svg>
    </button>

    <ul v-if="expanded" class="ref-file-list" data-testid="ref-file-list">
      <li v-for="doc in documents" :key="doc.id" class="ref-file-row">
        <span class="ref-file-name">{{ doc.filename }}</span>
        <span class="ref-file-status" :class="`is-${doc.status}`">{{ doc.status }}</span>
        <span v-if="doc.status === 'failed' && doc.error" class="ref-file-error">{{
          doc.error
        }}</span>
        <button
          type="button"
          class="ref-file-delete"
          :data-testid="`ref-delete-${doc.id}`"
          :aria-label="`Delete ${doc.filename}`"
          @click="confirmDelete(doc)"
        >
          <svg
            class="ref-icon"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M4 5.5 H16 M8 5.5 V4 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 v1.5 M6 5.5 L6.7 16 a1 1 0 0 0 1 0.9 h4.6 a1 1 0 0 0 1 -0.9 L14 5.5"
            />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'

import { getSessionIngestion, deleteDocument } from '../../services/uploadApi.js'
import { useToast } from '../../composables/useToast.js'

const props = defineProps({
  sessionId: { type: String, required: true },
})

const status = ref(null) // 'pending' | 'ready' | 'failed' | null
const documents = ref([])
const expanded = ref(false)

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

const confirm = useConfirm()
const { showSuccess, showError } = useToast()

function confirmDelete(doc) {
  confirm.require({
    message: `Remove "${doc.filename}" from this chat? This deletes the file and its indexed content.`,
    header: 'Delete file',
    // No glyph icon font in this world -- the dialog carries no mark.
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    // Neutral cancel (drops the default primary/coral fill); darker destructive
    // accept via the global .confirm-delete-strong rule in base.css.
    rejectClass: 'p-button-text p-button-secondary',
    acceptClass: 'p-button-danger confirm-delete-strong',
    accept: async () => {
      try {
        await deleteDocument(doc.id)
        showSuccess(`${doc.filename} removed.`)
        refresh()
      } catch {
        showError(`Could not delete ${doc.filename}. Please try again.`)
        refresh()
      }
    },
  })
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
/* Status caption grammar: one line, ink on paper, a full 1px rule. */
.ref-status {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  border: 1px solid var(--rule-strong);
  color: var(--ink);
}

.ref-status.is-ready {
  border-color: var(--signal-success);
}

.ref-status.is-failed {
  border-color: var(--ink-marker);
  color: var(--ink-marker-text);
}

.ref-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
}
/* Drawn strokes, not a glyph font: one weight, round ends, the caption's ink. */
.ref-icon {
  flex-shrink: 0;
}
.ref-chevron {
  margin-left: auto;
}
@media (prefers-reduced-motion: reduce) {
  .ref-spinner {
    animation: none;
  }
}
.ref-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.ref-file-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  border-top: 1px solid var(--rule);
}
.ref-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-file-status {
  color: var(--pencil);
}
.ref-file-status.is-failed {
  color: var(--ink-marker-text);
}
.ref-file-error {
  color: var(--ink-marker-text);
}
.ref-file-delete {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-learner);
  padding: 0.2rem;
  border-radius: var(--radius-sm);
}
.ref-file-delete:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

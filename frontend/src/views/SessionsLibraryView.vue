<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import { cardDescription, cardMeta } from '@/utils/sessionCard.js'
import EmptyState from '@/components/EmptyState.vue'

const router = useRouter()
const store = useSessionStore()

const items = ref([])
const total = ref(0)
const limit = ref(20)
const offset = ref(0)
const loading = ref(false)
const error = ref(null)

// Controls (wired in Task 7).
const status = ref('all')
const q = ref('')
const sort = ref('last_activity')

async function load() {
  loading.value = true
  error.value = null
  try {
    const page = await store.fetchLibrary({
      status: status.value,
      q: q.value || undefined,
      sort: sort.value,
      limit: limit.value,
      offset: offset.value,
    })
    items.value = page.items
    total.value = page.total
    limit.value = page.limit
    offset.value = page.offset
  } catch (e) {
    error.value = e?.message || 'Failed to load sessions'
  } finally {
    loading.value = false
  }
}

function open(id) {
  router.push({ name: 'session', params: { id } })
}

onMounted(load)
defineExpose({ load }) // used by control/pagination tasks
</script>

<template>
  <main class="library">
    <header class="library-head">
      <h1 class="library-title">All sessions</h1>
    </header>

    <p v-if="loading" class="muted" data-testid="library-loading">Loading...</p>
    <p v-else-if="error" class="error" data-testid="library-error">{{ error }}</p>

    <EmptyState
      v-else-if="!items.length"
      tone="pause"
      eyebrow="library"
      headline="No sessions found"
      subtext="Try a different filter or start a new session."
    />

    <ul v-else class="library-grid">
      <li
        v-for="s in items"
        :key="s.id"
        class="library-card"
        :data-testid="`library-card-${s.id}`"
        role="button"
        tabindex="0"
        @click="open(s.id)"
        @keydown.enter="open(s.id)"
      >
        <div class="library-card-head">
          <span class="library-topic">{{ s.topic || 'Untitled' }}</span>
          <span class="library-status" :class="{ ended: !!s.ended_at }">
            {{ s.ended_at ? 'Ended' : 'Active' }}
          </span>
        </div>
        <p class="library-desc">{{ cardDescription(s) || 'No activity yet' }}</p>
        <p class="library-meta">{{ cardMeta(s) }}</p>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.library {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}

.library-title {
  font-size: 1.4rem;
  margin: 0 0 16px;
  color: var(--color-heading);
}

.library-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.library-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 14px);
  background: var(--color-surface);
  padding: 14px;
  cursor: pointer;
  transition: border-color var(--motion-fast, 140ms);
}

.library-card:hover {
  border-color: var(--color-accent-soft);
}

.library-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.library-topic {
  font-weight: 600;
  color: var(--color-text);
}

.library-status {
  font-size: 0.72rem;
  color: var(--color-accent-text);
}

.library-status.ended {
  color: var(--color-text-muted);
}

.library-desc {
  margin: 8px 0 4px;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.library-meta {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error, #e05252);
}
</style>

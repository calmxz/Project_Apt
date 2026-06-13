<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import { cardStory, cardChips, cardMeta } from '@/utils/sessionCard.js'
import EmptyState from '@/components/EmptyState.vue'
import SessionChips from '@/components/SessionChips.vue'

const router = useRouter()
const store = useSessionStore()

async function continueSession(id) {
  await store.reopenSession(id)
  router.push({ name: 'session', params: { id } })
}

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

const STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'ended', label: 'Ended' },
]

function setStatus(next) {
  status.value = next
  offset.value = 0
  load()
}

function onSortChange() {
  offset.value = 0
  load()
}

let searchTimer = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    load()
  }, 250)
}

const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + limit.value < total.value)
const rangeLabel = computed(() => {
  if (!total.value) return '0 of 0'
  const start = offset.value + 1
  const end = Math.min(offset.value + limit.value, total.value)
  return `${start}-${end} of ${total.value}`
})

function nextPage() {
  if (!hasNext.value) return
  offset.value += limit.value
  load()
}
function prevPage() {
  if (!hasPrev.value) return
  offset.value = Math.max(0, offset.value - limit.value)
  load()
}

onMounted(load)
onUnmounted(() => clearTimeout(searchTimer))
defineExpose({ load }) // used by control/pagination tasks
</script>

<template>
  <main class="library">
    <header class="library-head">
      <RouterLink to="/" class="library-back" data-testid="library-back">
        <i class="pi pi-arrow-left" aria-hidden="true" />
        Back to home
      </RouterLink>
      <h1 class="library-title">All sessions</h1>
    </header>

    <div class="library-controls">
      <div class="library-filter" role="group" aria-label="Filter by status">
        <button
          v-for="opt in STATUSES"
          :key="opt.key"
          type="button"
          class="library-filter-btn"
          :class="{ active: status === opt.key }"
          :data-testid="`library-filter-${opt.key}`"
          :aria-pressed="status === opt.key"
          @click="setStatus(opt.key)"
        >
          {{ opt.label }}
        </button>
      </div>

      <input
        v-model="q"
        type="search"
        class="library-search"
        data-testid="library-search"
        placeholder="Search topics..."
        aria-label="Search sessions by topic"
        @input="onSearchInput"
      />

      <select
        v-model="sort"
        class="library-sort"
        data-testid="library-sort"
        aria-label="Sort sessions"
        @change="onSortChange"
      >
        <option value="last_activity">Last active</option>
        <option value="created">Newest</option>
        <option value="topic">Topic</option>
      </select>
    </div>

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
      >
        <RouterLink
          class="library-card-link"
          :to="{ name: 'session', params: { id: s.id } }"
        >
          <div class="library-card-head">
            <span class="library-topic">{{ s.topic || 'Untitled' }}</span>
            <span class="library-status" :class="{ ended: !!s.ended_at }">
              {{ s.ended_at ? 'Ended' : 'Active' }}
            </span>
          </div>
          <p
            class="library-desc"
            :class="{
              'library-desc-muted': !cardStory(s),
              'library-desc-quote': !s.ended_at && !!cardStory(s),
            }"
          >
            {{ cardStory(s) || 'No activity yet' }}
          </p>
          <SessionChips
            v-if="cardChips(s).length"
            class="library-chips"
            :chips="cardChips(s)"
            variant="card"
          />
          <p class="library-meta">{{ cardMeta(s) }}</p>
        </RouterLink>
        <button
          v-if="s.ended_at"
          type="button"
          class="library-continue"
          :data-testid="`library-continue-${s.id}`"
          @click="continueSession(s.id)"
        >
          Continue
        </button>
      </li>
    </ul>

    <nav v-if="items.length" class="library-pager" aria-label="Pagination">
      <button
        type="button"
        class="library-pg-btn"
        data-testid="library-prev"
        :disabled="!hasPrev"
        @click="prevPage"
      >
        Prev
      </button>
      <span class="library-range">{{ rangeLabel }}</span>
      <button
        type="button"
        class="library-pg-btn"
        data-testid="library-next"
        :disabled="!hasNext"
        @click="nextPage"
      >
        Next
      </button>
    </nav>
  </main>
</template>

<style scoped>
.library {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}

.library-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  text-decoration: none;
}
.library-back:hover {
  color: var(--color-accent);
  text-decoration: underline;
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
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 14px);
  background: var(--color-surface);
  transition: border-color var(--motion-fast, 140ms);
}

.library-card:hover {
  border-color: var(--color-accent-soft);
}

.library-card-link {
  display: block;
  padding: 14px;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.library-card-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.library-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* Reserve top-right room for the de-nested Continue on ended cards so the
   status badge does not slide under it. */
.library-card:has(.library-continue) .library-card-head {
  padding-right: 5.5rem;
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

.library-continue {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  flex-shrink: 0;
  padding: 0.3rem 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-accent-soft);
  color: var(--color-accent-text);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--motion-fast) ease;
}

.library-continue:hover {
  background: var(--color-accent-soft);
}

.library-continue:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.library-desc {
  margin: 8px 0 4px;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.library-desc-muted {
  color: var(--color-text-muted);
  font-style: italic;
}

.library-desc-quote {
  font-style: italic;
}

.library-desc-quote::before {
  content: '\201C';
}

.library-desc-quote::after {
  content: '\201D';
}

.library-chips {
  margin-top: 0.125rem;
}

.library-meta {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.library-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.library-filter {
  display: flex;
  gap: 4px;
}

.library-filter-btn {
  padding: 5px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background var(--motion-fast, 140ms), border-color var(--motion-fast, 140ms);
}

.library-filter-btn:hover {
  border-color: var(--color-accent-soft);
}

.library-filter-btn.active {
  background: var(--color-accent-strong);
  border-color: var(--color-accent-strong);
  color: var(--color-text-on-accent);
}

.library-search,
.library-sort {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 8px);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.85rem;
  padding: 5px 10px;
}

.library-search {
  flex: 1 1 180px;
}

.library-sort {
  flex: 0 0 auto;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error, #e05252);
}

.library-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
}

.library-pg-btn {
  padding: 5px 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--color-text);
  font-size: 0.85rem;
  cursor: pointer;
  transition: border-color var(--motion-fast, 140ms);
}

.library-pg-btn:hover:not(:disabled) {
  border-color: var(--color-accent-soft);
}

.library-pg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.library-range {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
</style>

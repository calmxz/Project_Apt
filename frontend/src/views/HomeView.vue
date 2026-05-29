<template>
  <section class="home">
    <header class="head">
      <div class="head-text">
        <span class="folio">your shelf</span>
        <h1 class="title">Sessions</h1>
        <p class="lede" data-testid="home-lede">
          <template v-if="activeCount">
            {{ activeCount }} active {{ activeCount === 1 ? 'session' : 'sessions' }}. Pick one from the sidebar, or start a new one.
          </template>
          <template v-else>
            A study session is one conversation about one topic. Begin one.
          </template>
        </p>
      </div>
      <div class="head-cta">
        <button
          type="button"
          class="cta-primary"
          data-testid="home-new-session"
          @click="goNew"
        >
          <span>New session</span>
          <i class="pi pi-plus" aria-hidden="true" />
        </button>
      </div>
    </header>

    <p v-if="store.loading" class="muted">Loading...</p>
    <p
      v-else-if="store.error"
      class="error"
      data-testid="home-error"
    >
      {{ friendlyError(store.error) }}
    </p>

    <template v-else>
      <div
        v-if="duplicateCount > 0"
        class="dupe-banner"
        data-testid="home-dupe-banner"
      >
        <div class="dupe-text">
          <i class="pi pi-exclamation-triangle dupe-icon" aria-hidden="true" />
          <p class="dupe-line">
            {{ duplicateCount }} duplicate active {{ duplicateCount === 1 ? 'session' : 'sessions' }} detected.
            Keep the newest per topic, end the rest?
          </p>
        </div>
        <button
          type="button"
          class="dupe-btn"
          :disabled="cleaning"
          data-testid="home-dupe-cleanup"
          @click="cleanupDuplicates"
        >
          <span>{{ cleaning ? 'Cleaning…' : 'Clean up' }}</span>
          <i class="pi pi-broom" aria-hidden="true" />
        </button>
      </div>

      <EmptyState
        v-if="!store.sessions.length"
        data-testid="home-empty-active"
        tone="celebrate"
        eyebrow="page 01"
        headline="No sessions yet"
        subtext="Start your first one — the tutor adapts as you go."
      >
        <template #cta>
          <button type="button" class="cta-primary" @click="goNew">
            <span>Start your first session</span>
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </button>
        </template>
      </EmptyState>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import EmptyState from '../components/EmptyState.vue'

import { friendlyError } from '../lib/errors.js'
import * as sessionsApi from '../services/sessionsApi.js'
import { useSessionStore } from '../stores/session.js'
import { normalizeTopicKey } from '../utils/formatDate.js'

const router = useRouter()
const store = useSessionStore()

const cleaning = ref(false)

onMounted(async () => {
  await store.listSessions().catch(() => {})
})

const activeSessions = computed(() =>
  store.sessions.filter((s) => !s.ended_at),
)
const activeCount = computed(() => activeSessions.value.length)

const duplicateActiveIds = computed(() => {
  const byTopic = new Map()
  for (const s of activeSessions.value) {
    const key = normalizeTopicKey(s.topic)
    const list = byTopic.get(key) || []
    list.push(s)
    byTopic.set(key, list)
  }
  const dupes = []
  for (const list of byTopic.values()) {
    if (list.length <= 1) continue
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    for (let i = 1; i < list.length; i++) dupes.push(list[i].id)
  }
  return dupes
})

const duplicateCount = computed(() => duplicateActiveIds.value.length)

function goNew() {
  router.push({ name: 'new-session' })
}

async function cleanupDuplicates() {
  const ids = duplicateActiveIds.value
  if (!ids.length) return
  cleaning.value = true
  try {
    await Promise.all(ids.map((id) => sessionsApi.endSession(id)))
    await store.listSessions()
  } catch (e) {
    store.setError(e?.message || 'Cleanup failed.')
  } finally {
    cleaning.value = false
  }
}
</script>

<style scoped>
.home {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
  max-width: 32rem;
  font-size: 1.0625rem;
}

.head-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.375rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce), box-shadow var(--motion-fast) ease;
}

.cta-primary:hover {
  transform: translateY(-2px);
}

.cta-primary:active {
  transform: translateY(4px);
  box-shadow: var(--shadow-pop-pressed);
}

.cta-primary:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error);
}

/* Duplicate banner */
.dupe-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem 0.875rem 1.125rem;
  background: rgba(255, 176, 32, 0.12);
  border: 1px solid rgba(255, 176, 32, 0.35);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}

.dupe-text {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 14rem;
}

.dupe-icon {
  color: var(--signal-warning);
  font-size: 1.125rem;
}

.dupe-line {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.4;
}

.dupe-btn {
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

.dupe-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
}

.dupe-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

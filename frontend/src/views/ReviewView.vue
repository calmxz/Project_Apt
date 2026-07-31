<template>
  <section class="review">
    <header class="head">
      <span class="folio">spaced repetition</span>
      <h1 class="title">Review</h1>
      <p class="lede">Concepts due for a quick check.</p>
    </header>

    <p v-if="queue.total > 0" class="count" data-testid="review-count">
      {{ queue.total }} concept{{ queue.total === 1 ? '' : 's' }} ready.
    </p>

    <ul v-if="queue.items.length" class="review-list">
      <li v-for="item in queue.items" :key="item.concept">
        <button
          type="button"
          class="review-item"
          data-testid="review-item"
          :disabled="startBusy"
          @click="startReview(item)"
        >
          <span class="review-concept">{{ item.concept }}</span>
          <span class="review-meta">{{ item.source_topic }} &middot; streak {{ item.streak }}</span>
        </button>
      </li>
    </ul>

    <p v-else-if="loaded" class="empty" data-testid="review-empty">
      Nothing due right now. Keep learning &mdash; concepts you master come back here for a check.
      <RouterLink to="/" class="empty-link">Back home</RouterLink>
    </p>

    <button
      v-if="!expanded && queue.total > queue.items.length"
      type="button"
      class="review-more"
      data-testid="review-more"
      @click="expand"
    >
      View all {{ queue.total }}
    </button>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session.js'
import { getReviewQueue } from '../services/reviewApi.js'

const router = useRouter()
const store = useSessionStore()

const queue = ref({ items: [], total: 0 })
const loaded = ref(false)
const expanded = ref(false)
const startBusy = ref(false)

onMounted(() => {
  load(3, { silent: true })
})

async function load(limit = 3, { silent } = {}) {
  try {
    // Only the mount call passes silent:true; the user-initiated "View all"
    // refetch keeps the toast on a real failure.
    queue.value = silent
      ? await getReviewQueue({ limit, offset: 0 }, { silent: true })
      : await getReviewQueue({ limit, offset: 0 })
  } catch {
    // The review page must never block; show the empty state on failure.
    queue.value = { items: [], total: 0 }
  } finally {
    loaded.value = true
  }
}

async function startReview(item) {
  if (startBusy.value) return
  startBusy.value = true
  try {
    const created = await store.continueTopic({
      id: item.source_session_id,
      topic: item.source_topic,
    })
    if (created) {
      router.push({
        name: 'session',
        params: { id: created.id },
        query: { review_gap: item.concept },
      })
    }
  } catch {
    // F-45: store.continueTopic rethrows after _setError; without this catch
    // the rejection is unhandled and the double-click window stays open.
  } finally {
    startBusy.value = false
  }
}

async function expand() {
  expanded.value = true
  await load(100)
}
</script>

<style scoped>
.review {
  max-width: 42rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-top: 1.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 1rem;
}

.count {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}

.review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.review-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--motion-fast) ease;
}

.review-item:hover {
  border-color: var(--color-accent);
}

.review-item:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.review-concept {
  font-weight: 600;
  color: var(--color-heading);
}

.review-meta {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}

.empty-link {
  color: var(--color-accent);
  text-decoration: none;
}

.empty-link:hover {
  text-decoration: underline;
}

.review-more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  color: var(--color-accent);
  cursor: pointer;
}

.review-more:hover {
  text-decoration: underline;
}

.review-more:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
</style>

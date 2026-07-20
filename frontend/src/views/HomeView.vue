<template>
  <section class="home">
    <h1 class="title">What do you want to learn?</h1>

    <p v-if="store.loading" class="muted">Loading...</p>
    <p v-else-if="store.error && !store.sessions.length" class="error" data-testid="home-error">
      {{ friendlyError(store.error) }}
    </p>

    <template v-else>
      <div class="modes">
        <div class="mode-card" data-testid="home-mode-quick">
          <h2 class="mode-title">New lesson</h2>
          <p class="mode-sub">One topic. Type and go.</p>
          <input
            v-model="quickTopic"
            class="quick-input"
            data-testid="home-quick-topic"
            placeholder="e.g. Recursion"
            @keydown.enter="startQuick"
          />
          <button
            type="button"
            class="cta-primary"
            data-testid="home-quick-go"
            :disabled="startBusy"
            @click="startQuick"
          >
            <span>Start</span><i class="pi pi-arrow-right" aria-hidden="true" />
          </button>
          <RouterLink to="/new" class="quick-more">Add reference files</RouterLink>
        </div>

        <div v-if="reviewQueue.total > 0" class="mode-card" data-testid="home-mode-review">
          <h2 class="mode-title">Due for review</h2>
          <p class="mode-sub" data-testid="home-review-count">
            {{ reviewQueue.total }} concept{{ reviewQueue.total === 1 ? '' : 's' }} ready for a
            quick check.
          </p>
          <ul class="review-list">
            <li v-for="item in reviewQueue.items" :key="item.concept">
              <button
                type="button"
                class="review-item"
                data-testid="home-review-item"
                :disabled="startBusy"
                @click="startReview(item)"
              >
                <span class="review-concept">{{ item.concept }}</span>
                <span class="review-meta"
                  >{{ item.source_topic }} &middot; streak {{ item.streak }}</span
                >
              </button>
            </li>
          </ul>
          <button
            v-if="!reviewExpanded && reviewQueue.total > reviewQueue.items.length"
            type="button"
            class="review-more"
            data-testid="home-review-more"
            @click="expandReview"
          >
            View all {{ reviewQueue.total }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session.js'
import { getReviewQueue } from '../services/reviewApi.js'
import { friendlyError } from '../lib/errors.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')
const reviewQueue = ref({ items: [], total: 0 })
const reviewExpanded = ref(false)
const startBusy = ref(false)

onMounted(() => {
  // U-05: boot-path load - the failure is already handled locally (store
  // error state / empty review card), so a transient backend hiccup here
  // must not toast on Home's very first mount. store.listSessions() is
  // silent unconditionally now (sessionsApi.js), so it can't be defeated by
  // racing another mounted caller (e.g. Sidebar) into the store's in-flight
  // de-dupe. getReviewQueue has no such de-dupe, so silent:true is threaded
  // per-call here instead; the user-initiated "View all" refetch below
  // stays toasted.
  store.listSessions().catch(() => {})
  loadReviewQueue(3, { silent: true })
})

async function startQuick() {
  const topic = quickTopic.value.trim()
  if (!topic || startBusy.value) return
  startBusy.value = true
  try {
    const created = await store.createSession({ topic, seedMode: 'fresh', priorSessionId: null })
    if (created) router.push({ name: 'session', params: { id: created.id } })
  } catch (e) {
    if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
      router.push({ name: 'session', params: { id: e.body.detail.session_id } })
    }
    // other errors surface via store.error / friendlyError in the template
  } finally {
    startBusy.value = false
  }
}

async function loadReviewQueue(limit = 3, { silent } = {}) {
  try {
    // Only the boot-mount call passes silent:true; user-initiated refetches
    // (expandReview's "View all") keep the toast on a real failure, so pass
    // the opts arg through conditionally rather than always as {}.
    reviewQueue.value = silent
      ? await getReviewQueue({ limit, offset: 0 }, { silent: true })
      : await getReviewQueue({ limit, offset: 0 })
  } catch {
    // The review card must never block Home; hide it on failure.
    reviewQueue.value = { items: [], total: 0 }
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

async function expandReview() {
  reviewExpanded.value = true
  await loadReviewQueue(100)
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

.title {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--color-error-text);
}

/* Mode cards */
.modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 1rem;
}

.mode-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-pop);
}

.mode-title {
  font-family: var(--font-display);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
}

.mode-sub {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.quick-input {
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 1rem;
  transition: border-color var(--motion-fast) ease;
}

.quick-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.quick-input::placeholder {
  color: var(--color-text-muted);
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.375rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #ffffff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition:
    transform var(--motion-fast) var(--motion-bounce),
    box-shadow var(--motion-fast) ease;
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

.quick-more {
  font-size: 0.9rem;
  color: var(--color-accent);
  text-decoration: none;
  transition: text-decoration var(--motion-fast) ease;
}

.quick-more:hover {
  text-decoration: underline;
}

.quick-more:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
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

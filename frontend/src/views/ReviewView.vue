<template>
  <section class="review">
    <BackButton label="Back" fallback="/" />
    <header class="head">
      <h1 class="title">Review</h1>
      <p class="lede">Concepts due for a quick check.</p>
      <p class="lede">Each check that you get right extends the gap before the next one.</p>
    </header>

    <p v-if="queue.total > 0" class="count" data-testid="review-count">
      {{ queue.total }} concept{{ queue.total === 1 ? '' : 's' }} ready.
    </p>

    <ul v-if="queue.items.length" class="review-list">
      <li
        v-for="(item, i) in queue.items"
        :key="item.concept"
        class="review-row"
        data-testid="review-row"
      >
        <button
          type="button"
          class="review-item"
          data-testid="review-item"
          :disabled="startBusy"
          @click="startReview(item)"
        >
          <span class="review-concept">{{ item.concept }}</span>
        </button>

        <div class="review-answer" :class="{ lifted: isLifted(item) }">
          <p v-show="isLifted(item)" :id="detailId(i)" class="review-detail">
            {{ item.source_topic }} &middot;
            {{ item.streak === 1 ? '1 correct in a row' : `${item.streak} correct in a row` }}
          </p>
          <button
            type="button"
            class="review-cover"
            :class="{ 'review-cover--lifted': isLifted(item) }"
            :data-testid="`review-cover-${i}`"
            :aria-expanded="isLifted(item) ? 'true' : 'false'"
            :aria-controls="detailId(i)"
            :aria-label="
              isLifted(item)
                ? `Cover the answer for ${item.concept}`
                : `Lift the cover on ${item.concept}`
            "
            @click="toggle(item)"
          >
            {{ isLifted(item) ? 'Cover' : 'Lift' }}
          </button>
        </div>
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
import BackButton from '../components/BackButton.vue'
import { useSessionStore } from '../stores/session.js'
import { getReviewQueue } from '../services/reviewApi.js'

const router = useRouter()
const store = useSessionStore()

const queue = ref({ items: [], total: 0 })
const loaded = ref(false)
const expanded = ref(false)
const startBusy = ref(false)

// Cornell recitation: the cue stays readable, what sits beside it is covered
// until the learner lifts that one cover. Keyed by concept (the queue's own
// key) so a refetch keeps whatever the learner has already lifted.
const lifted = ref(new Set())

function isLifted(item) {
  return lifted.value.has(item.concept)
}

function toggle(item) {
  const next = new Set(lifted.value)
  if (next.has(item.concept)) next.delete(item.concept)
  else next.add(item.concept)
  lifted.value = next
}

function detailId(i) {
  return `review-detail-${i}`
}

onMounted(() => {
  load(3, { silent: true })
})

async function load(limit = 3, { silent } = {}) {
  try {
    // Only the mount call passes silent:true; the user-initiated "View all"
    // refetch keeps the toast on a real failure.
    const opts = silent ? [{ silent: true }] : []
    queue.value = await getReviewQueue({ limit, offset: 0 }, ...opts)
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
/* A recitation page: cues down the left, each answer beside its cue under a
   card the learner lifts. */
.review {
  max-width: 44rem;
  margin: 0 auto;
  padding-top: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  flex-direction: column;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.count {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

/* Rows sit apart on the desk so stacked cards read as separate objects. */
.review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  row-gap: 0.75rem;
}

/* Every row is a fixed height in both states, so lifting a cover never
   reflows the list. */
.review-row {
  display: grid;
  grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
  align-items: start;
  column-gap: 1rem;
  min-height: 3.5rem;
}

/* The cue itself: a blue cue word, and the control that starts the check.
   Written, not stamped. */
.review-item {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  text-align: left;
  cursor: pointer;
}

.review-item:hover:not(:disabled) .review-concept {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.review-item:disabled {
  color: var(--pencil);
  cursor: default;
}

.review-item:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* The cue takes its own width and wraps; a cue word is never truncated --
   it is the thing the learner has to recall. */
.review-concept {
  display: block;
  overflow-wrap: anywhere;
}

/* The answer area holds one card at a time: covered (blue stock) or lifted
   (white stock, with the pencil aside above it). */
.review-answer {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-height: 3.5rem;
}

.review-answer.lifted {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.375rem;
}

/* Lifted, the revealed answer is a card in the tutor's white stock. */
.review-detail {
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Lifted, the aside is written onto the rules left to right. v-show keeps the
   copy in the DOM, so the animation restarts each time display returns. */
.review-answer.lifted .review-detail {
  animation: review-land var(--motion-ink) var(--motion-out-expo) both;
}

@keyframes review-land {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .review-answer.lifted .review-detail {
    animation: none;
  }
}

/* Covered, the answer cell is a card in the learner's blue stock: the way
   in written inside it. */
.review-cover {
  flex: 1 1 auto;
  padding: 0.8125rem 1rem;
  border: 1px solid var(--card-learner-edge);
  border-radius: var(--radius-card);
  background: var(--card-learner);
  box-shadow: 0 1px 0 var(--card-drop);
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  text-align: left;
  cursor: pointer;
}

/* Lifted, the card turns to white stock and shrinks to a text-sized
   control: Cover reads as a plain blue line under the revealed aside. */
.review-cover--lifted {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.review-cover:hover {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.review-cover:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.empty {
  margin: 0;
  max-width: 42rem;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.empty-link {
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.empty-link:hover {
  color: var(--color-accent-hover);
}

.review-more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.review-more:hover {
  color: var(--color-accent-hover);
}

.review-more:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (max-width: 599px) {
  .review-row {
    grid-template-columns: minmax(0, 1fr);
    column-gap: 0;
  }
}
</style>

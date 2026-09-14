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
/* A recitation page: cues down the left, the answer beside each one under a
   cover the learner lifts. Rules and columns, no cards. */
.review {
  max-width: 44rem;
  margin: 0 auto;
  padding-top: var(--line-pitch);
  display: flex;
  flex-direction: column;
  gap: var(--line-pitch);
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
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.count {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

/* Rows sit one pitch apart so stacked covers are separated by ruled ground
   and never butt frames: 56px row + 28px gap = three pitches per entry. */
.review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  row-gap: var(--line-pitch);
  background-image: var(--ruled-bg);
  background-position-y: var(--ruled-offset);
  background-attachment: local;
}

/* Every row is exactly two pitches in both states, so lifting a cover never
   reflows the list. */
.review-row {
  display: grid;
  grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
  align-items: start;
  column-gap: 1rem;
  min-height: calc(2 * var(--line-pitch));
}

/* The cue itself: a blue cue word on the rule, and the control that starts
   the check. Written, not stamped. */
.review-item {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
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

/* The cue takes its own width and wraps on the pitch; a cue word is never
   truncated -- it is the thing the learner has to recall. */
.review-concept {
  display: block;
  overflow-wrap: anywhere;
}

/* The answer area. Covered, it is a blank sheet over the rules with the way
   in written on it; lifted, it reads as a pencil aside. */
.review-answer {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-height: calc(2 * var(--line-pitch));
}

/* Lifted, the cell keeps its two pitches: the aside on line one, Cover
   written on line two. */
.review-answer.lifted {
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
}

.review-detail {
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
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

/* Covered, the answer cell is a ruled box: a graphite frame with page ground
   over the rules and the way in written inside it. */
.review-cover {
  flex: 1 1 auto;
  padding: 13px 1rem;
  border: 1px solid var(--ink);
  border-radius: 0;
  background: var(--color-background);
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  text-align: left;
  cursor: pointer;
}

/* Lifted, the box is gone and Cover is a plain blue text line. */
.review-answer.lifted .review-cover {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
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
  line-height: var(--line-pitch);
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
  line-height: var(--line-pitch);
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

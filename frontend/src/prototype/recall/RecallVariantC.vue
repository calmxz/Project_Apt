<script setup>
// PROTOTYPE variant C - Card stack. One concept at a time on a white check
// card, the rest fanned behind it. "Check this one" starts the check;
// "Not now" sends the card to the back (in memory only). A plain list of
// everything due sits folded under the stack.
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { dueSince, streakLabel } from '../recallProto.js'

const props = defineProps({
  items: { type: Array, required: true },
  busy: { type: Boolean, default: false },
})
defineEmits(['start'])

// Local order over concept keys so "Not now" survives a refetch of the same
// queue and the stack starts most-overdue-first.
const order = ref([])
watch(
  () => props.items,
  (items) => {
    const keys = items.map((i) => i.concept)
    const kept = order.value.filter((k) => keys.includes(k))
    const fresh = keys.filter((k) => !kept.includes(k))
    order.value = [...kept, ...fresh]
  },
  { immediate: true },
)

const stack = computed(() =>
  order.value.map((k) => props.items.find((i) => i.concept === k)).filter(Boolean),
)
const top = computed(() => stack.value[0] || null)
const rest = computed(() => stack.value.slice(1))

function later() {
  if (order.value.length < 2) return
  const [head, ...tail] = order.value
  order.value = [...tail, head]
}
</script>

<template>
  <section class="stackpage">
    <template v-if="top">
      <div class="fan" :data-behind="Math.min(rest.length, 2)">
        <div v-if="rest.length > 1" class="ghost ghost-2" aria-hidden="true" />
        <div v-if="rest.length > 0" class="ghost ghost-1" aria-hidden="true" />
        <article class="card" aria-live="polite">
          <p class="card-head">{{ dueSince(top.due_at) }} &middot; from {{ top.source_topic }}</p>
          <h2 class="card-concept">{{ top.concept }}</h2>
          <p class="card-streak">{{ streakLabel(top.streak) }}</p>
          <div class="card-actions">
            <button type="button" class="go" :disabled="busy" @click="$emit('start', top)">
              Check this one
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  d="M3 9h11M10 4.5L14.5 9 10 13.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button v-if="rest.length" type="button" class="later" :disabled="busy" @click="later">
              Not now
            </button>
          </div>
        </article>
      </div>

      <p class="behind">
        <template v-if="rest.length === 0">Last one in the box.</template>
        <template v-else-if="rest.length === 1">1 more behind it.</template>
        <template v-else>{{ rest.length }} more behind it.</template>
      </p>

      <details class="all">
        <summary>All {{ stack.length }} due</summary>
        <ol class="all-list">
          <li v-for="item in stack" :key="item.concept" class="all-row">
            <button type="button" class="all-cue" :disabled="busy" @click="$emit('start', item)">
              {{ item.concept }}
            </button>
            <span class="all-meta"
              >{{ item.source_topic }} &middot; {{ dueSince(item.due_at) }}</span
            >
          </li>
        </ol>
      </details>
    </template>

    <article v-else class="card card-empty">
      <p class="card-head">Nothing due</p>
      <h2 class="card-concept card-concept-empty">The box is clear.</h2>
      <p class="card-streak">Concepts you hold come back here when a check is due.</p>
      <div class="card-actions">
        <RouterLink to="/" class="later">Back home</RouterLink>
      </div>
    </article>
  </section>
</template>

<style scoped>
.stackpage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

/* Room below for the fanned ghosts. */
.fan {
  position: relative;
  width: 100%;
  max-width: 32rem;
  padding-bottom: 1.25rem;
}

/* A check card: white stock, 3px ink head rule, the pencil head line first. */
.card {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  min-height: 14rem;
  padding: 1.25rem 1.5rem 1.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-top: 3px solid var(--ink);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  animation: card-in var(--motion-base) var(--motion-out-expo) both;
}

@keyframes card-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card {
    animation: none;
  }
}

/* The cards behind: same stock, peeking out under the top one. */
.ghost {
  position: absolute;
  left: 0;
  right: 0;
  height: 3rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.ghost-1 {
  bottom: 0.625rem;
  margin: 0 0.5rem;
  z-index: 1;
}

.ghost-2 {
  bottom: 0;
  margin: 0 1rem;
  z-index: 0;
}

.card-head {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.card-concept {
  margin: 0.25rem 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.card-concept-empty {
  color: var(--pencil);
}

.card-streak {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.card-actions {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
  margin-top: auto;
  padding-top: 1rem;
}

/* Page CTA: blue text with the drawn arrow. */
.go {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--lh-body);
  cursor: pointer;
}

.go:hover:not(:disabled) {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.later {
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

.later:hover:not(:disabled) {
  color: var(--color-accent-hover);
}

.go:disabled,
.later:disabled {
  color: var(--pencil);
  cursor: default;
}

.go:focus-visible,
.later:focus-visible,
.all-cue:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.behind {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.all {
  width: 100%;
  max-width: 32rem;
  margin-top: 1rem;
}

summary {
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.all-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  border-top: 1px solid var(--rule-strong);
}

.all-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  min-height: 2.5rem;
  border-bottom: 1px solid var(--rule);
}

.all-cue {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.all-cue:hover:not(:disabled) {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.all-meta {
  flex: 0 1 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-empty {
  max-width: 32rem;
  min-height: 0;
}

/* Narrow (repo's 599px breakpoint; not yet viewed in a browser at 390): card runs edge to edge, ghosts fan tighter,
   the fold list stacks meta under the cue. */
@media (max-width: 599px) {
  .card {
    min-height: 12rem;
    padding: 1rem 1rem 1.25rem;
  }

  .ghost-1 {
    margin: 0 0.375rem;
  }

  .ghost-2 {
    margin: 0 0.75rem;
  }

  .all-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding: 0.375rem 0;
  }

  .all-meta {
    white-space: normal;
  }
}
</style>

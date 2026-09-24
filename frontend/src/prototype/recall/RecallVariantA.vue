<script setup>
// PROTOTYPE variant A - Ledger. One flat ruled list, most overdue first.
// Every row: cue (blue, starts the check) | from <topic> | due-since | streak
// as tally strokes. No cards; the page is one sheet of ruled lines.
import { RouterLink } from 'vue-router'
import { dueSince, streakLabel } from '../recallProto.js'

defineProps({
  items: { type: Array, required: true },
  busy: { type: Boolean, default: false },
})
defineEmits(['start'])

function strokes(n) {
  return Math.min(n, 5)
}
</script>

<template>
  <section class="ledger">
    <template v-if="items.length">
      <p class="count">{{ items.length }} due, most overdue first.</p>
      <ol class="rows">
        <li v-for="item in items" :key="item.concept" class="row">
          <button
            type="button"
            class="cue"
            :disabled="busy"
            :aria-label="`Check ${item.concept}, from ${item.source_topic}, ${dueSince(item.due_at)}, ${streakLabel(item.streak)}`"
            @click="$emit('start', item)"
          >
            <span class="concept">{{ item.concept }}</span>
            <svg class="arrow" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
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
          <span class="from" aria-hidden="true">{{ item.source_topic }}</span>
          <span class="when" aria-hidden="true">{{ dueSince(item.due_at) }}</span>
          <span class="tally" :title="streakLabel(item.streak)" aria-hidden="true">
            <svg
              v-if="item.streak"
              :width="strokes(item.streak) * 6 + 2"
              height="14"
              viewBox="0 0 32 14"
            >
              <line
                v-for="k in strokes(item.streak)"
                :key="k"
                :x1="k * 6 - 3"
                y1="1.5"
                :x2="k * 6 - 4"
                y2="12.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <span v-else class="tally-none">&ndash;</span>
          </span>
        </li>
      </ol>
    </template>

    <p v-else class="empty" data-testid="review-empty">
      Nothing due. Concepts you hold come back here when a check is due.
      <RouterLink to="/" class="empty-link">Back home</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.ledger {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.count {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--rule-strong);
}

/* One line of the ledger per concept. Fixed pitch so the page reads as
   ruled paper, not a list of boxes. */
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 12rem) 8.5rem 2.5rem;
  align-items: center;
  column-gap: 1rem;
  min-height: 3.5rem;
  border-bottom: 1px solid var(--rule);
}

.cue {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
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

.concept {
  overflow-wrap: anywhere;
}

.arrow {
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity var(--motion-fast);
}

.cue:hover:not(:disabled) .concept {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cue:hover:not(:disabled) .arrow,
.cue:focus-visible .arrow {
  opacity: 1;
}

.cue:disabled {
  color: var(--pencil);
  cursor: default;
}

.cue:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.from,
.when {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.when {
  text-align: right;
}

.tally {
  display: flex;
  justify-content: flex-end;
  color: var(--ink);
}

.tally-none {
  color: var(--pencil);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
}

.empty {
  margin: 0;
  padding: 1rem 0;
  border-top: 1px solid var(--rule-strong);
  border-bottom: 1px solid var(--rule);
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

/* Narrow (repo's 599px breakpoint; not yet viewed in a browser at 390): cue on its own line, the three pencil facts on a
   second line under it. Pitch grows to two lines. */
@media (max-width: 599px) {
  .row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'cue cue'
      'from when'
      'tally tally';
    row-gap: 0;
    padding: 0.5rem 0;
    min-height: 0;
  }

  .cue {
    grid-area: cue;
  }

  .from {
    grid-area: from;
  }

  .when {
    grid-area: when;
  }

  .tally {
    grid-area: tally;
    justify-content: flex-start;
  }
}
</style>

<script setup>
// PROTOTYPE variant B - Dividers by source. The box's tabbed dividers, one
// per source session: the tab names the topic and how many are due, the
// sheet under it holds the due concepts as blue cards. Per-divider action
// checks the most overdue card in that group.
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { dueSince, groupBySource, streakLabel } from '../recallProto.js'

const props = defineProps({
  items: { type: Array, required: true },
  busy: { type: Boolean, default: false },
})
defineEmits(['start'])

const groups = computed(() => groupBySource(props.items))
</script>

<template>
  <section class="dividers">
    <template v-if="groups.length">
      <div v-for="g in groups" :key="g.id" class="group">
        <div class="tab">
          <span class="tab-topic">{{ g.topic }}</span>
          <span class="tab-count">{{ g.items.length }} due</span>
        </div>
        <div class="sheet">
          <ul class="cards">
            <li v-for="item in g.items" :key="item.concept">
              <button type="button" class="card" :disabled="busy" @click="$emit('start', item)">
                <span class="card-head">{{ dueSince(item.due_at) }}</span>
                <span class="card-concept">{{ item.concept }}</span>
                <span class="card-streak">{{ streakLabel(item.streak) }}</span>
              </button>
            </li>
          </ul>
          <button
            type="button"
            class="check-group"
            :disabled="busy"
            @click="$emit('start', g.items[0])"
          >
            Check {{ g.topic }} now
            <span class="check-group-first">starts with {{ g.items[0].concept }}</span>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="group">
      <div class="tab">
        <span class="tab-topic">Nothing due</span>
      </div>
      <div class="sheet sheet-empty">
        <p class="empty">
          No divider has a concept due. Finish a session and its concepts file themselves here when
          a check comes round.
        </p>
        <RouterLink to="/" class="empty-link">Back home</RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dividers {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.group {
  display: flex;
  flex-direction: column;
}

/* The divider's tab: same stock and joined corner as the Settings rail. */
.tab {
  display: inline-flex;
  align-items: baseline;
  gap: 0.625rem;
  align-self: flex-start;
  position: relative;
  z-index: 1;
  margin-bottom: -1px;
  padding: 0.5rem 1rem;
  border: 1px solid var(--card-edge);
  border-bottom: 0;
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  background: var(--card);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  max-width: 100%;
}

.tab-topic {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-count {
  flex: 0 0 auto;
  font-weight: 400;
  color: var(--pencil);
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: 0 var(--radius-card) var(--radius-card) var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 0.75rem;
}

/* Each due concept is a card in the learner's blue stock, the pencil head
   line first (due-since), the cue, then the streak. */
.card {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  width: 100%;
  min-height: 5.5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--card-learner-edge);
  border-radius: var(--radius-card);
  background: var(--card-learner);
  box-shadow: 0 1px 0 var(--card-drop);
  color: var(--ink-learner);
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
}

.card-head,
.card-streak {
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.card-concept {
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--lh-body);
  overflow-wrap: anywhere;
}

.card:hover:not(:disabled) .card-concept {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.card:disabled {
  color: var(--pencil);
  cursor: default;
}

.card:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.check-group {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
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
  text-align: left;
  cursor: pointer;
}

.check-group-first {
  font-weight: 400;
  color: var(--pencil);
  text-decoration: none;
}

.check-group:hover:not(:disabled) {
  color: var(--color-accent-hover);
}

.check-group:disabled {
  color: var(--pencil);
  cursor: default;
}

.check-group:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sheet-empty {
  gap: 0.5rem;
}

.empty {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.empty-link {
  align-self: flex-start;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.empty-link:hover {
  color: var(--color-accent-hover);
}

/* Narrow (390px checked): one card per line, the sheet loses its side
   padding so cards run near the edge like the chat's learner cards. */
@media (max-width: 599px) {
  .cards {
    grid-template-columns: minmax(0, 1fr);
  }

  .card {
    min-height: 0;
  }

  .sheet {
    padding: 0.75rem;
  }
}
</style>

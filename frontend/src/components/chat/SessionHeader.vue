<script setup>
import { computed } from 'vue'

import { formatRelative } from '../../utils/formatDate.js'
import { LEVEL_MARK_PATH, levelStroke } from './levelMark.js'

const props = defineProps({
  topic: { type: String, default: '' },
  sessionId: { type: String, default: '' },
  startedAt: { type: String, default: '' },
  level: { type: String, default: '' },
})

const started = computed(() =>
  props.startedAt ? `started ${formatRelative(props.startedAt)}` : '',
)
const levelText = computed(() => props.level || 'level not set')
const stroke = computed(() => levelStroke(props.level))
</script>

<template>
  <header v-if="topic" class="session-header" data-testid="session-header">
    <h1 class="session-topic-wrap">
      <RouterLink
        v-if="sessionId"
        :to="`/session/${sessionId}/profile`"
        class="session-topic session-topic-link"
        :title="`${topic} — open session profile`"
        data-testid="session-topic-link"
      >
        {{ topic }}
      </RouterLink>
      <span v-else class="session-topic" :title="topic">{{ topic }}</span>
    </h1>
    <p class="session-meta">
      <span v-if="started" class="session-started">{{ started }}</span>
      <span v-if="started" class="session-meta-sep" aria-hidden="true">&middot;</span>
      <span class="session-level">
        <svg
          class="session-level-mark"
          viewBox="0 0 24 24"
          width="28"
          height="18"
          aria-hidden="true"
          focusable="false"
        >
          <path :d="LEVEL_MARK_PATH" :stroke-width="stroke" />
        </svg>
        {{ levelText }}
      </span>
    </p>
  </header>
</template>

<style scoped>
.session-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1.5rem;
  min-height: 72px;
  padding: 1.25rem clamp(1rem, 3vw, 1.5rem);
  background: var(--color-background);
  border-bottom: 1px solid var(--rule-strong);
}

.session-topic-wrap {
  margin: 0;
  min-width: 0;
}

.session-topic {
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-topic-link {
  text-decoration: none;
  cursor: pointer;
}

.session-topic-link:hover {
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.session-topic-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 0;
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
  white-space: nowrap;
}

/* One caption line: the date, a pencil middot, then the level and its stroke.
   The middot only exists when there is a date to separate from. */
.session-meta-sep {
  flex: 0 0 auto;
  color: var(--pencil);
}

.session-level {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

/* The header meta line is pencil throughout: date and level are notes to the
   side of the page, not part of its ink. */
.session-level-mark {
  fill: none;
  stroke: var(--pencil);
  stroke-linecap: round;
}

@media (max-width: 899px) {
  .session-header {
    min-height: 0;
    padding: 0.75rem clamp(1rem, 3vw, 1.5rem);
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
  }

  .session-topic {
    font-size: var(--fs-h2);
  }
}
</style>

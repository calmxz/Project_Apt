<script setup>
defineProps({
  topic: { type: String, default: '' },
  sessionId: { type: String, default: '' },
})
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
  </header>
</template>

<style scoped>
.session-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-background);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 0.75rem clamp(1rem, 3vw, 1.5rem);
  border-bottom: 1px solid transparent;
  transition: border-color var(--motion-fast) ease;
}

.session-topic-wrap {
  margin: 0;
  min-width: 0;
}

.session-topic {
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 2.5vw, 1.5rem);
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  line-height: 1.2;
  color: var(--color-heading);
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-topic-link {
  text-decoration: none;
  cursor: pointer;
  border-radius: var(--radius-sm, 6px);
  transition: color var(--motion-fast) ease;
}

.session-topic-link:hover {
  color: var(--color-accent-strong);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.session-topic-link:focus-visible {
  outline: 2px solid var(--color-accent-strong);
  outline-offset: 3px;
}

/* Mobile: sit below sticky top strip added in S4 (token defaulted to 3rem). */
@media (max-width: 1279px) {
  .session-header {
    top: var(--sidebar-mobile-strip-height, 3rem);
  }
}
</style>

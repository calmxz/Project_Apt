<script setup>
defineProps({
  topic: { type: String, default: '' },
})
</script>

<template>
  <header v-if="topic" class="session-header" data-testid="session-header">
    <h1 class="session-topic" :title="topic">{{ topic }}</h1>
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

.session-topic {
  font-family: var(--font-display);
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  line-height: 1.2;
  color: var(--color-heading);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Mobile: sit below sticky top strip added in S4 (token defaulted to 3rem). */
@media (max-width: 1279px) {
  .session-header {
    top: var(--sidebar-mobile-strip-height, 3rem);
  }
}
</style>

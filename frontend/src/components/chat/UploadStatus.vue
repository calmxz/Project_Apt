<template>
  <p
    v-if="upload"
    class="upload-status"
    :class="`upload-status-${upload.kind}`"
    :data-testid="`upload-status-${upload.kind}`"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ upload.text }}
  </p>
</template>

<script setup>
defineProps({
  upload: {
    type: Object,
    default: null,
  },
})
</script>

<style scoped>
/* A status caption card: card stock with a 3px tab-colour rule at the head,
   never a side border. Lands in one snap and leaves clean. */
.upload-status {
  display: block;
  margin: 0;
  padding: 0.4rem 0.75rem;
  background: var(--card);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  border: 1px solid var(--card-edge);
  border-top: 3px solid var(--color-accent);
  /* Head rule reads as a tab edge: top corners square, bottom corners card radius. */
  border-radius: 0 0 var(--radius-card) var(--radius-card);
  color: var(--ink);
  animation: upload-land var(--motion-ink) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes upload-land {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}

.upload-status-ready {
  border-top-color: var(--tab-mastered);
}

.upload-status-failed {
  border-top-color: var(--tab-focus);
  color: var(--ink-marker-text);
}

@media (prefers-reduced-motion: reduce) {
  .upload-status {
    animation: none;
  }
}
</style>

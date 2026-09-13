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
/* One status caption: ink on paper inside a full 1px rule, landing in one
   snap and leaving clean. */
.upload-status {
  display: block;
  margin: 0;
  padding: 0.25rem 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
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
  border-color: var(--signal-success);
}

.upload-status-failed {
  border-color: var(--ink-marker);
  color: var(--ink-marker-text);
}

@media (prefers-reduced-motion: reduce) {
  .upload-status {
    animation: none;
  }
}
</style>

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
.upload-status {
  margin: 0;
  padding: 0.5rem 0.875rem;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  align-self: flex-start;
  display: inline-block;
}

.upload-status-ready {
  background: rgba(34, 197, 94, 0.12);
  color: var(--color-success-text);
}

.upload-status-failed {
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-error-text);
}
</style>

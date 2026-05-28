<script setup>
defineProps({
  count: { type: Number, default: 3 },
})
</script>

<template>
  <ul class="sb-skel-list" aria-hidden="true">
    <li v-for="i in count" :key="i" class="sb-skel-row">
      <span class="sb-skel-dot" />
      <span class="sb-skel-lines">
        <span class="sb-skel-line sb-skel-topic" />
        <span class="sb-skel-line sb-skel-meta" />
      </span>
    </li>
  </ul>
</template>

<style scoped>
.sb-skel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sb-skel-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
}

.sb-skel-dot {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-soft);
  animation: sb-skel-pulse 1.4s ease-in-out infinite;
}

.sb-skel-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.sb-skel-line {
  height: 0.625rem;
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
  animation: sb-skel-pulse 1.4s ease-in-out infinite;
}

.sb-skel-topic {
  width: 75%;
}

.sb-skel-meta {
  width: 45%;
  height: 0.5rem;
  opacity: 0.7;
}

@keyframes sb-skel-pulse {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 0.35; }
}
</style>

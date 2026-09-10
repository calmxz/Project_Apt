<script setup>
defineProps({ count: { type: Number, default: 6 } })
</script>

<template>
  <ul class="library-grid skel-grid" aria-hidden="true" data-testid="library-skeleton">
    <li v-for="i in count" :key="i" class="skel-card">
      <span class="skel-line skel-topic" />
      <span class="skel-line skel-body" />
      <span class="skel-line skel-body short" />
      <span class="skel-line skel-meta" />
    </li>
  </ul>
</template>

<style scoped>
.skel-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 1rem;
}
.skel-card {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 7rem;
}
.skel-line {
  display: block;
  height: 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  animation: skel-pulse 1.4s ease-in-out infinite;
}
.skel-topic {
  width: 55%;
  height: 0.9rem;
}
.skel-body {
  width: 92%;
}
.skel-body.short {
  width: 70%;
}
.skel-meta {
  width: 40%;
  height: 0.6rem;
  margin-top: auto;
}
@keyframes skel-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skel-line {
    animation: none;
  }
}
</style>

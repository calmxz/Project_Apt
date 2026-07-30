<script setup>
import { routeProgress } from '@/services/routeProgress.js'
</script>

<template>
  <div
    v-if="routeProgress.visible"
    class="route-progress"
    data-testid="route-progress"
    aria-hidden="true"
  >
    <div
      class="route-progress-bar"
      :class="{ done: routeProgress.progress >= 1 }"
      :style="{ width: routeProgress.progress * 100 + '%' }"
    />
  </div>
</template>

<style scoped>
.route-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 1000;
  pointer-events: none;
}
.route-progress-bar {
  height: 100%;
  background: var(--color-accent, #e26d5c);
  /* Slow ease-out = trickle toward 85% while the chunk loads. */
  transition: width 8s cubic-bezier(0.1, 0.6, 0.2, 1);
}
.route-progress-bar.done {
  transition: width 150ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .route-progress-bar,
  .route-progress-bar.done {
    transition: none;
  }
}
</style>

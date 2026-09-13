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
/* A 2px blue rule drawn along the top edge of the page. It is ink arriving,
   so it fades in and out; it never slides, lifts or glows. */
.route-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 1000;
  pointer-events: none;
  animation: route-progress-in var(--motion-fast) linear;
}

.route-progress-bar {
  height: 100%;
  background: var(--ink-learner);
  /* Slow ease-out = the rule extends toward 85% while the chunk loads. */
  transition: width 8s cubic-bezier(0.1, 0.6, 0.2, 1);
}

.route-progress-bar.done {
  transition:
    width 150ms ease,
    opacity var(--motion-fast) linear;
  opacity: 0;
}

@keyframes route-progress-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .route-progress {
    animation: none;
  }
  .route-progress-bar,
  .route-progress-bar.done {
    transition: none;
    opacity: 1;
  }
}
</style>

<script setup>
import { RouterLink } from 'vue-router'
import { useSidebar } from '@/composables/useSidebar.js'
import Logo from '@/components/Logo.vue'

const { openDrawer } = useSidebar()
</script>

<template>
  <div class="sb-strip" data-testid="sidebar-mobile-strip">
    <button
      type="button"
      class="sb-strip-btn hit-44"
      aria-label="Open sessions sidebar"
      title="Sessions"
      data-testid="sidebar-mobile-hamburger"
      @click="openDrawer"
    >
      <svg
        class="sb-strip-icon"
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3.5 6 H16.5 M3.5 10 H16.5 M3.5 14 H16.5" />
      </svg>
    </button>
    <RouterLink to="/" class="sb-strip-brand hit-44" aria-label="Crux home">
      <Logo size="sm" variant="full" />
    </RouterLink>
    <div class="sb-strip-actions">
      <RouterLink
        to="/settings"
        class="sb-strip-btn hit-44"
        aria-label="Settings"
        title="Settings"
        data-testid="strip-settings"
      >
        <svg
          class="sb-strip-icon"
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="10" cy="10" r="2.5" />
          <path
            d="M10 3.5 V5.5 M10 14.5 V16.5 M16.5 10 H14.5 M5.5 10 H3.5 M14.7 5.3 L13.3 6.7 M6.7 13.3 L5.3 14.7 M14.7 14.7 L13.3 13.3 M6.7 6.7 L5.3 5.3"
          />
        </svg>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
/* One rule across the top of the page: wordmark, menu, settings. No shadow. */
.sb-strip {
  position: sticky;
  top: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: var(--sidebar-mobile-strip-height, 3rem);
  padding: 0 0.5rem;
  background: var(--desk-deep);
  border-bottom: 1px solid var(--card-edge);
}

.sb-strip-brand {
  display: inline-flex;
  text-decoration: none;
  color: var(--color-heading);
  margin-right: auto;
  padding: 0 0.25rem;
}

.sb-strip-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.sb-strip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  text-decoration: none;
  cursor: pointer;
  font-size: 1rem;
  transition: color var(--motion-fast) ease;
}

.sb-strip-btn:hover {
  color: var(--ink-learner);
}

.sb-strip-btn:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: 2px;
}
</style>

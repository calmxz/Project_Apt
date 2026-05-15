<script setup>
import { RouterLink, RouterView } from 'vue-router'
import { useTheme } from './composables/useTheme.js'

const { isDark, toggle } = useTheme()
</script>

<template>
  <header class="topnav">
    <div class="topnav-inner">
      <RouterLink to="/" class="brand" aria-label="AdaptLearn home">
        <span class="brand-mark" aria-hidden="true">§</span>
        <span class="brand-name">AdaptLearn</span>
      </RouterLink>
      <nav class="actions">
        <button
          type="button"
          class="icon-btn theme-toggle"
          :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          :data-mode="isDark ? 'dark' : 'light'"
          @click="toggle"
        >
          <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'" />
        </button>
        <RouterLink to="/settings" class="icon-btn" aria-label="Settings">
          <i class="pi pi-cog" />
        </RouterLink>
      </nav>
    </div>
  </header>
  <main class="page">
    <div class="page-inner">
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </div>
  </main>
</template>

<style>
.topnav {
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--color-background) 88%, transparent);
  backdrop-filter: saturate(140%) blur(10px);
  -webkit-backdrop-filter: saturate(140%) blur(10px);
  border-bottom: 1px solid var(--color-border);
}

.topnav-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0.875rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.brand {
  display: inline-flex;
  align-items: baseline;
  gap: 0.625rem;
  color: var(--color-heading);
  text-decoration: none;
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: 1.125rem;
  letter-spacing: var(--tracking-tight);
  transition: color 150ms ease;
}

.brand:hover {
  color: var(--color-accent);
}

.brand-mark {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 400;
  color: var(--color-accent);
  font-size: 1.4rem;
  line-height: 1;
}

.brand-name {
  font-variation-settings: 'opsz' 144;
}

.actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  text-decoration: none;
  font-size: 1rem;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}

.icon-btn:hover {
  color: var(--color-heading);
  border-color: var(--color-border);
  background: var(--color-surface);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.page {
  position: relative;
  flex: 1;
  z-index: 1;
}

.page-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 4.5rem) clamp(1rem, 4vw, 2.5rem) 4rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

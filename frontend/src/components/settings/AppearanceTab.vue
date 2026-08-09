<template>
  <section class="card" data-testid="settings-appearance">
    <h2 class="card-title">
      <i class="pi pi-moon card-icon" aria-hidden="true" />
      Appearance
    </h2>
    <div class="switch-row">
      <span class="switch-body">
        <span class="switch-label">Dark mode</span>
        <span class="switch-sub">Use a dark theme across the app.</span>
      </span>
      <button
        type="button"
        class="switch"
        :class="{ 'switch--on': isDark }"
        role="switch"
        :aria-checked="isDark"
        aria-label="Dark mode"
        data-testid="settings-theme-toggle"
        @click="toggleTheme"
      >
        <span class="switch-knob" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<script setup>
import { useTheme } from '../../composables/useTheme.js'

const { isDark, toggle: toggleTheme } = useTheme()
</script>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-paper);
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
}

.card-icon {
  font-size: 1rem;
  color: var(--color-accent-text);
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.switch-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.switch-label {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

.switch-sub {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.switch {
  position: relative;
  flex-shrink: 0;
  width: 2.75rem;
  height: 1.5rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-strong);
  background: var(--color-border-strong);
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    border-color var(--motion-fast) ease;
}

.switch--on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.switch:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.switch-knob {
  position: absolute;
  top: 50%;
  left: 0.1875rem;
  width: 1.125rem;
  height: 1.125rem;
  transform: translateY(-50%);
  border-radius: var(--radius-pill);
  background: #ffffff;
  box-shadow: var(--shadow-paper);
  transition: left var(--motion-fast) var(--motion-bounce);
}

.switch--on .switch-knob {
  left: calc(100% - 1.3125rem);
}
</style>

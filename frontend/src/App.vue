<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import Toast from 'primevue/toast'
import { useTheme } from './composables/useTheme.js'
import { useToast } from './composables/useToast.js'
import { errorBus } from './services/errorBus.js'
import { useAuthStore } from './stores/auth.js'
import Logo from './components/Logo.vue'

const { isDark, toggle } = useTheme()
const { showError } = useToast()
const router = useRouter()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)

// Skip 429 (daily-cap has dedicated banner+toast in SessionView) and 404
// (consumers typically render "not found" inline; double-surfacing is noisy).
const onApiError = (e) => {
  const err = e.detail
  if (!err || err.status === 429 || err.status === 404) return
  const msg = err?.body?.detail || err?.message || 'Request failed'
  showError(typeof msg === 'string' ? msg : JSON.stringify(msg))
}
onMounted(() => errorBus.addEventListener('api-error', onApiError))
onBeforeUnmount(() => errorBus.removeEventListener('api-error', onApiError))

async function onSignOut() {
  try {
    await authStore.signOut()
  } catch (err) {
    showError(err?.message || 'Sign out failed')
    return
  }
  router.push('/login')
}
</script>

<template>
  <header class="topnav">
    <div class="topnav-inner">
      <RouterLink to="/" class="brand" aria-label="AdaptLearn home">
        <Logo size="md" variant="full" />
      </RouterLink>
      <nav class="actions">
        <RouterLink
          to="/profile"
          class="icon-btn"
          aria-label="Combined profile"
          data-testid="nav-profile"
        >
          <i class="pi pi-user" />
        </RouterLink>
        <button
          type="button"
          class="theme-toggle"
          role="switch"
          :aria-checked="isDark"
          :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          :data-mode="isDark ? 'dark' : 'light'"
          @click="toggle"
        >
          <span class="theme-toggle-thumb" aria-hidden="true" />
          <span class="theme-toggle-icon sun" :class="{ active: !isDark }">
            <i class="pi pi-sun" />
          </span>
          <span class="theme-toggle-icon moon" :class="{ active: isDark }">
            <i class="pi pi-moon" />
          </span>
        </button>
        <RouterLink to="/settings" class="icon-btn" aria-label="Settings">
          <i class="pi pi-cog" />
        </RouterLink>
        <button
          v-if="isAuthenticated"
          type="button"
          class="icon-btn"
          aria-label="Sign out"
          data-testid="nav-sign-out"
          @click="onSignOut"
        >
          <i class="pi pi-sign-out" />
        </button>
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
  <Toast position="top-right" />
</template>

<style>
.topnav {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: 0.75rem 1rem 0;
}

.topnav-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0.625rem 1.25rem 0.625rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: var(--color-surface);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-lift);
  border: 1px solid var(--color-border);
}

.brand {
  display: inline-flex;
  text-decoration: none;
  transition: transform var(--motion-base) var(--motion-bounce);
}

.brand:hover {
  transform: translateY(-1px);
}

.brand:hover :deep(.logo-mark) {
  filter: drop-shadow(0 0 6px rgba(255, 107, 92, 0.55));
  transform: rotate(15deg) scale(1.06);
}

.brand :deep(.logo-mark) {
  transition: filter var(--motion-base) ease, transform var(--motion-base) var(--motion-bounce);
}

.actions {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  text-decoration: none;
  font-size: 1rem;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) ease;
}

.icon-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
  transform: translateY(-1px);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* Two-state pill theme toggle */
.theme-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  width: 4.25rem;
  height: 2rem;
  padding: 0.25rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
  cursor: pointer;
  color: var(--color-text-muted);
  font-family: inherit;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.theme-toggle:hover {
  border-color: var(--color-border-strong);
}

.theme-toggle:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.theme-toggle-thumb {
  position: absolute;
  top: 0.25rem;
  left: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--gradient-spark);
  box-shadow: 0 2px 6px rgba(255, 107, 92, 0.45);
  transition: transform var(--motion-base) var(--motion-bounce);
  pointer-events: none;
}

.theme-toggle[data-mode="dark"] .theme-toggle-thumb {
  transform: translateX(2.25rem);
}

.theme-toggle-icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  transition: color var(--motion-fast) ease;
}

.theme-toggle-icon.active {
  color: #FFFFFF;
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
  transition: opacity var(--motion-base) ease, transform var(--motion-base) var(--motion-bounce);
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>

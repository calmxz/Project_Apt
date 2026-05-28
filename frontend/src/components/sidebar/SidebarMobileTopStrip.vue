<script setup>
import { RouterLink, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSidebar } from '@/composables/useSidebar.js'
import { useTheme } from '@/composables/useTheme.js'
import { useAuthStore } from '@/stores/auth.js'
import { useToast } from '@/composables/useToast.js'
import Logo from '@/components/Logo.vue'

const { openDrawer } = useSidebar()
const { isDark, toggle: toggleTheme } = useTheme()
const router = useRouter()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)
const { showError } = useToast()

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
  <div class="sb-strip" data-testid="sidebar-mobile-strip">
    <button
      type="button"
      class="sb-strip-btn"
      aria-label="Open sessions sidebar"
      title="Sessions"
      data-testid="sidebar-mobile-hamburger"
      @click="openDrawer"
    >
      <i class="pi pi-bars" />
    </button>
    <RouterLink to="/" class="sb-strip-brand" aria-label="AdaptLearn home">
      <Logo size="sm" variant="full" />
    </RouterLink>
    <div class="sb-strip-actions">
      <RouterLink
        to="/profile"
        class="sb-strip-btn"
        aria-label="Combined profile"
        title="Combined profile"
        data-testid="strip-profile"
      >
        <i class="pi pi-user" />
      </RouterLink>
      <button
        type="button"
        class="sb-strip-btn"
        role="switch"
        :aria-checked="isDark"
        :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        data-testid="strip-theme-toggle"
        @click="toggleTheme"
      >
        <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'" />
      </button>
      <button
        v-if="isAuthenticated"
        type="button"
        class="sb-strip-btn"
        aria-label="Sign out"
        title="Sign out"
        data-testid="strip-sign-out"
        @click="onSignOut"
      >
        <i class="pi pi-sign-out" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.sb-strip {
  position: sticky;
  top: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: var(--sidebar-mobile-strip-height, 3rem);
  padding: 0 0.5rem;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.sb-strip-brand {
  display: inline-flex;
  text-decoration: none;
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
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  text-decoration: none;
  cursor: pointer;
  font-size: 1rem;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.sb-strip-btn:hover {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
}

.sb-strip-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

<script setup>
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSidebar } from '@/composables/useSidebar.js'
import { useTheme } from '@/composables/useTheme.js'
import { useAuthStore } from '@/stores/auth.js'
import { useToast } from '@/composables/useToast.js'
import Logo from '@/components/Logo.vue'

const { mode, isDesktop, toggleDesktop, closeDrawer } = useSidebar()
const { isDark, toggle: toggleTheme } = useTheme()
const router = useRouter()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)
const { showError } = useToast()

const isExpanded = computed(() => mode.value === 'expanded' || mode.value === 'drawer-open')
const showCollapseToggle = computed(() => isDesktop.value)
const showDrawerClose = computed(() => !isDesktop.value && mode.value === 'drawer-open')

async function onSignOut() {
  try {
    await authStore.signOut()
  } catch (err) {
    showError(err?.message || 'Sign out failed')
    return
  }
  router.push('/login')
}

function onNewSession() {
  closeDrawer()
  router.push({ name: 'new-session' })
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--expanded': isExpanded, 'sidebar--collapsed': !isExpanded }"
    :data-mode="mode"
    aria-label="App navigation"
  >
    <div class="sb-header">
      <RouterLink
        to="/"
        class="sb-brand"
        aria-label="AdaptLearn home"
        @click="closeDrawer"
      >
        <Logo size="md" :variant="isExpanded ? 'full' : 'mark-only'" />
      </RouterLink>
      <button
        v-if="showCollapseToggle"
        type="button"
        class="sb-toggle"
        :aria-label="isExpanded ? 'Collapse sidebar' : 'Expand sidebar'"
        :title="isExpanded ? 'Collapse sidebar' : 'Expand sidebar'"
        data-testid="sidebar-collapse-toggle"
        @click="toggleDesktop"
      >
        <i :class="isExpanded ? 'pi pi-angle-double-left' : 'pi pi-angle-double-right'" />
      </button>
      <button
        v-if="showDrawerClose"
        type="button"
        class="sb-toggle"
        aria-label="Close sessions sidebar"
        title="Close"
        data-testid="sidebar-drawer-close"
        @click="closeDrawer"
      >
        <i class="pi pi-times" />
      </button>
    </div>

    <div class="sb-cta">
      <button
        type="button"
        class="sb-new-session"
        :class="{ 'sb-new-session--icon': !isExpanded }"
        :title="isExpanded ? '' : 'New session'"
        data-testid="sidebar-new-session"
        @click="onNewSession"
      >
        <i class="pi pi-plus" />
        <span v-if="isExpanded">New session</span>
      </button>
    </div>

    <nav class="sb-list-wrap" aria-label="Sessions">
      <!-- S2 fills in: SidebarSessionRow list + sections + skeleton + empty hint -->
      <slot name="list">
        <div v-if="isExpanded" class="sb-empty-placeholder" aria-hidden="true" />
      </slot>
    </nav>

    <footer class="sb-rail" :class="{ 'sb-rail--column': !isExpanded }">
      <RouterLink
        to="/profile"
        class="sb-icon"
        aria-label="Combined profile"
        title="Combined profile"
        data-testid="sidebar-profile"
        @click="closeDrawer"
      >
        <i class="pi pi-user" />
      </RouterLink>
      <button
        type="button"
        class="sb-icon"
        role="switch"
        :aria-checked="isDark"
        :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        data-testid="sidebar-theme-toggle"
        @click="toggleTheme"
      >
        <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'" />
      </button>
      <RouterLink
        to="/settings"
        class="sb-icon"
        aria-label="Settings"
        title="Settings"
        data-testid="sidebar-settings"
        @click="closeDrawer"
      >
        <i class="pi pi-cog" />
      </RouterLink>
      <button
        v-if="isAuthenticated"
        type="button"
        class="sb-icon"
        aria-label="Sign out"
        title="Sign out"
        data-testid="sidebar-sign-out"
        @click="onSignOut"
      >
        <i class="pi pi-sign-out" />
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
  background: var(--color-background);
  border-right: 1px solid var(--color-border);
  z-index: 30;
  overflow: hidden;
  transition: width var(--motion-base) ease;
}

.sidebar--expanded {
  width: var(--sidebar-width-expanded, 16rem);
}

.sidebar--collapsed {
  width: var(--sidebar-width-collapsed, 3rem);
}

.sb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem;
  min-height: 3.25rem;
}

.sidebar--collapsed .sb-header {
  justify-content: center;
  padding: 0.75rem 0.25rem;
}

.sb-brand {
  display: inline-flex;
  text-decoration: none;
  transition: transform var(--motion-base) var(--motion-bounce);
}

.sb-brand:hover {
  transform: translateY(-1px);
}

.sb-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.sb-toggle:hover {
  background: var(--color-surface-soft);
  color: var(--color-text);
}

.sb-toggle:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-cta {
  padding: 0.5rem 0.75rem 0.75rem;
}

.sidebar--collapsed .sb-cta {
  padding: 0.25rem;
  display: flex;
  justify-content: center;
}

.sb-new-session {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.875rem;
  background: var(--color-accent);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-body, 0.9375rem);
  font-weight: 600;
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) ease, box-shadow var(--motion-fast) ease;
}

.sb-new-session:hover {
  transform: translateY(-1px);
}

.sb-new-session:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-new-session--icon {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border-radius: var(--radius-pill);
}

.sb-list-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.25rem 0.5rem;
}

.sb-empty-placeholder {
  min-height: 4rem;
}

.sb-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.sb-rail--column {
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0.25rem;
}

.sb-icon {
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

.sb-icon:hover {
  color: var(--color-accent);
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
  transform: translateY(-1px);
}

.sb-icon:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

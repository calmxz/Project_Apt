<script setup>
defineOptions({ name: 'AppSidebar' })

import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSidebar } from '@/composables/useSidebar.js'
import { useTheme } from '@/composables/useTheme.js'
import { useAuthStore } from '@/stores/auth.js'
import { useSessionStore } from '@/stores/session.js'
import { useToast } from '@/composables/useToast.js'
import Logo from '@/components/Logo.vue'
import SidebarSessionRow from './SidebarSessionRow.vue'
import SidebarSkeletonList from './SidebarSkeletonList.vue'

const { mode, isDesktop, toggleDesktop, closeDrawer } = useSidebar()
const { isDark, toggle: toggleTheme } = useTheme()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)
const sessionStore = useSessionStore()
const { sessions, loading } = storeToRefs(sessionStore)
const { showError } = useToast()

const listEl = ref(null)
const endedOpen = ref(true)

const activeSessions = computed(() =>
  sessions.value.filter((s) => !s.ended_at),
)

const endedSessions = computed(() =>
  sessions.value.filter((s) => Boolean(s.ended_at)),
)

const showSkeleton = computed(() => loading.value && !sessions.value.length)

const showEmptyHint = computed(
  () => !loading.value && !activeSessions.value.length && !endedSessions.value.length,
)

// Fetch only if we haven't loaded yet. HomeView also calls listSessions on mount;
// shared Pinia store means second call refetches (and that's fine — it'll be
// fresh data), but skipping when populated avoids the deep-link redundant fetch.
onMounted(async () => {
  if (isAuthenticated.value && !sessions.value.length) {
    await sessionStore.listSessions().catch(() => {})
  }
})

// Auto-collapse Ended section when there are many ended sessions, default open
// when there are few. Per spec: collapsed if > 5, open if ≤ 5.
watch(
  endedSessions,
  (rows) => {
    if (rows.length > 5) endedOpen.value = false
    else endedOpen.value = true
  },
  { immediate: true },
)

// Scroll the active session row into view on route change.
watch(
  () => route.params.id,
  async () => {
    await nextTick()
    if (!listEl.value) return
    const target = listEl.value.querySelector(
      `[data-session-id="${route.params.id}"]`,
    )
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
)

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
  <Teleport to="body" :disabled="isDesktop">
    <div
      v-if="!isDesktop && mode === 'drawer-open'"
      class="sb-backdrop"
      data-testid="sidebar-backdrop"
      @click="closeDrawer"
    />
  </Teleport>
  <aside
    class="sidebar"
    :class="{
      'sidebar--expanded': isExpanded,
      'sidebar--collapsed': !isExpanded && isDesktop,
      'sidebar--drawer': !isDesktop,
      'sidebar--drawer-open': !isDesktop && mode === 'drawer-open',
    }"
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

    <nav ref="listEl" class="sb-list-wrap" aria-label="Sessions">
      <template v-if="isExpanded">
        <section class="sb-section sb-section--active" data-testid="sidebar-section-active">
          <h3 class="sb-section-label label">
            Active
            <span v-if="!showSkeleton" class="sb-section-count">({{ activeSessions.length }})</span>
          </h3>
          <SidebarSkeletonList v-if="showSkeleton" :count="3" />
          <ul v-else-if="activeSessions.length" class="sb-session-list">
            <SidebarSessionRow
              v-for="s in activeSessions"
              :key="s.id"
              :session="s"
              state="active"
            />
          </ul>
          <p
            v-else-if="showEmptyHint"
            class="sb-empty-hint"
            data-testid="sidebar-empty-hint"
          >
            No sessions yet. Click + New session above.
          </p>
        </section>

        <section
          v-if="endedSessions.length"
          class="sb-section sb-section--ended"
          data-testid="sidebar-section-ended"
        >
          <button
            type="button"
            class="sb-section-toggle label"
            :aria-expanded="endedOpen"
            aria-controls="sb-ended-list"
            data-testid="sidebar-ended-toggle"
            @click="endedOpen = !endedOpen"
          >
            <span>
              Ended <span class="sb-section-count">({{ endedSessions.length }})</span>
            </span>
            <i
              :class="endedOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
              aria-hidden="true"
            />
          </button>
          <ul
            v-show="endedOpen"
            id="sb-ended-list"
            class="sb-session-list"
          >
            <SidebarSessionRow
              v-for="s in endedSessions"
              :key="s.id"
              :session="s"
              state="ended"
            />
          </ul>
        </section>
      </template>

      <!-- Collapsed icon rail: compact row markers without sections -->
      <template v-else>
        <ul v-if="sessions.length" class="sb-session-list sb-session-list--collapsed">
          <SidebarSessionRow
            v-for="s in [...activeSessions, ...endedSessions]"
            :key="s.id"
            :session="s"
            :state="s.ended_at ? 'ended' : 'active'"
          />
        </ul>
      </template>
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

/* Mobile drawer: fixed overlay that slides in from the left. The shell grid
   column collapses to zero so the main column gets full width when the drawer
   is closed. */
.sidebar--drawer {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--sidebar-width-expanded, 16rem);
  max-width: 85vw;
  transform: translateX(-100%);
  transition: transform var(--motion-base) ease;
  box-shadow: var(--shadow-lift);
}

.sidebar--drawer-open {
  transform: translateX(0);
}

/* Collapsed grid column when the drawer is closed on mobile. */
.sidebar--drawer:not(.sidebar--drawer-open) {
  pointer-events: none;
}

.sb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 29;
  background: rgba(0, 0, 0, 0.5);
  animation: sb-fade-in var(--motion-fast) ease;
}

@keyframes sb-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
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

.sb-section {
  margin-bottom: 0.75rem;
}

.sb-section-label,
.sb-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem 0.75rem 0.25rem;
  margin: 0;
  border: 0;
  background: transparent;
  cursor: default;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.sb-section-toggle {
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--motion-fast) ease, background var(--motion-fast) ease;
}

.sb-section-toggle:hover {
  color: var(--color-text);
}

.sb-section-toggle:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-section-count {
  font-variant-numeric: tabular-nums;
  color: var(--color-text-faint);
  font-weight: 500;
}

.sb-session-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.sb-session-list--collapsed {
  align-items: center;
  gap: 0.25rem;
}

.sb-empty-hint {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
  padding: 0.5rem 0.75rem;
  margin: 0;
  line-height: 1.4;
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

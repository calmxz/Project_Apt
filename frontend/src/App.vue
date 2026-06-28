<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import { useToast } from './composables/useToast.js'
import { useSidebar } from './composables/useSidebar.js'
import { errorBus } from './services/errorBus.js'
import Sidebar from './components/sidebar/Sidebar.vue'
import SidebarMobileTopStrip from './components/sidebar/SidebarMobileTopStrip.vue'

const { showError } = useToast()
const route = useRoute()
const { isDesktop, closeDrawer } = useSidebar()

const showShell = computed(() => route.meta?.sidebar !== false)
const { drawerOpen } = useSidebar()

// Close mobile drawer on every route change so tapping a session row
// dismisses the overlay (mobile UX expectation).
watch(() => route.fullPath, () => closeDrawer())

// Lock body scroll while the mobile drawer is open so the user doesn't
// scroll the page underneath the backdrop.
watch(drawerOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.body.classList.add('sb-scroll-lock')
  else document.body.classList.remove('sb-scroll-lock')
})
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.classList.remove('sb-scroll-lock')
  }
})

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
</script>

<template>
  <div v-if="showShell" class="shell">
    <a class="skip-link" href="#main-content" data-testid="skip-link">
      Skip to main content
    </a>
    <Sidebar />
    <div class="shell-main">
      <SidebarMobileTopStrip v-if="!isDesktop" />
      <main id="main-content" class="page">
        <div class="page-inner">
          <RouterView v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </RouterView>
        </div>
      </main>
    </div>
  </div>
  <RouterView v-else v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </RouterView>
  <Toast position="top-right" />
  <ConfirmDialog />
</template>

<style>
.shell {
  display: grid;
  grid-template-columns: auto 1fr;
  min-height: 100vh;
  align-items: stretch;
}

.shell-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100vh;
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

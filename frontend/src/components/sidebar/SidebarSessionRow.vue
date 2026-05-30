<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatRelative } from '@/utils/formatDate.js'
import { useSidebar } from '@/composables/useSidebar.js'
import { useSessionStore } from '@/stores/session.js'
import SidebarRowMenu from './SidebarRowMenu.vue'

const props = defineProps({
  session: { type: Object, required: true },
  /** 'active' | 'ended' */
  state: { type: String, required: true },
})

const route = useRoute()
const router = useRouter()
const store = useSessionStore()
const { mode, closeDrawer } = useSidebar()

const busy = ref(false)

const isCurrent = computed(() => route.params.id === props.session.id)
const isCollapsed = computed(() => mode.value === 'collapsed')

const whenLabel = computed(() => {
  const ts = props.state === 'ended' ? props.session.ended_at : props.session.created_at
  if (!ts) return ''
  const verb = props.state === 'ended' ? 'ended' : 'started'
  return `${verb} ${formatRelative(ts)}`
})

const tooltip = computed(() => {
  const ts = props.state === 'ended' ? props.session.ended_at : props.session.created_at
  return ts ? `${props.session.topic || 'Untitled'} · ${formatRelative(ts)}` : props.session.topic || 'Untitled'
})

function openSession() {
  closeDrawer()
  router.push({ name: 'session', params: { id: props.session.id } })
}

async function onEnd() {
  if (busy.value) return
  busy.value = true
  try {
    await store.endSession(props.session.id)
  } catch {
    /* store.error populated */
  } finally {
    busy.value = false
  }
}

async function onResume() {
  if (busy.value) return
  busy.value = true
  try {
    await store.reopenSession(props.session.id)
    closeDrawer()
    router.push({ name: 'session', params: { id: props.session.id } })
  } catch {
    /* store.error populated */
  } finally {
    busy.value = false
  }
}

function refocusRowTrigger(id) {
  nextTick(() => {
    const row = document.querySelector(`[data-session-id="${id}"]`)
    row?.querySelector('[data-testid="sidebar-row-menu-trigger"]')?.focus()
  })
}

function onPin() {
  const id = props.session.id
  store.setPinned(id, true).catch(() => {})
  refocusRowTrigger(id)
}

function onUnpin() {
  const id = props.session.id
  store.setPinned(id, false).catch(() => {})
  refocusRowTrigger(id)
}

function onRename() {
  /* Task 11 will implement inline rename */
}
</script>

<template>
  <li
    class="sb-row"
    :class="{
      'sb-row--current': isCurrent,
      'sb-row--ended': state === 'ended',
      'sb-row--collapsed': isCollapsed,
    }"
    :data-session-id="session.id"
    :data-testid="`sidebar-row-${session.id}`"
  >
    <button
      type="button"
      class="sb-row-button"
      :aria-current="isCurrent ? 'page' : undefined"
      :aria-label="`Open session: ${session.topic || 'Untitled'}`"
      :title="isCollapsed ? tooltip : ''"
      data-testid="sidebar-row-open"
      @click="openSession"
    >
      <span class="sb-row-dot" :class="{ 'sb-row-dot--filled': isCurrent }" aria-hidden="true" />
      <span v-if="!isCollapsed" class="sb-row-body">
        <span class="sb-row-topic">{{ session.topic || 'Untitled' }}</span>
        <span v-if="whenLabel" class="sb-row-meta">{{ whenLabel }}</span>
      </span>
    </button>
    <SidebarRowMenu
      v-if="!isCollapsed"
      :state="state"
      :busy="busy"
      :pinned="session.pinned ?? false"
      @end="onEnd"
      @resume="onResume"
      @pin="onPin"
      @unpin="onUnpin"
      @rename="onRename"
    />
  </li>
</template>

<style scoped>
.sb-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0;
  margin: 0;
  border-radius: var(--radius-md);
  list-style: none;
  transition: background var(--motion-fast) ease;
}

.sb-row:hover,
.sb-row:focus-within {
  background: var(--color-surface-soft);
}

.sb-row:hover :deep(.sb-row-menu-trigger),
.sb-row:focus-within :deep(.sb-row-menu-trigger) {
  opacity: 1;
}

.sb-row--current {
  background: var(--color-accent-soft);
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.sb-row--current:hover {
  background: var(--color-accent-soft);
}

.sb-row-button {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text);
  border-radius: var(--radius-md);
}

.sb-row-button:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: -2px;
}

.sb-row-dot {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--color-text-faint);
  background: transparent;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.sb-row-dot--filled {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.sb-row--ended .sb-row-dot {
  border-color: var(--color-text-faint);
}

.sb-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.sb-row-topic {
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}

.sb-row--ended .sb-row-topic {
  color: var(--color-text-muted);
  font-weight: 400;
}

.sb-row-meta {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.sb-row--collapsed {
  justify-content: center;
}

.sb-row--collapsed .sb-row-button {
  padding: 0.5rem;
  justify-content: center;
}
</style>

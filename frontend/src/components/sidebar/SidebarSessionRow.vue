<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { cardChips, railMeta } from '@/utils/sessionCard.js'
import SessionChips from '../SessionChips.vue'
import { useSidebar } from '@/composables/useSidebar.js'
import { useSessionStore } from '@/stores/session.js'
import { useToast } from '@/composables/useToast.js'
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
const { showSuccess } = useToast()

const busy = ref(false)

const renaming = ref(false)
const draft = ref('')
const inputEl = ref(null)

const isCurrent = computed(() => route.params.id === props.session.id)
const isCollapsed = computed(() => mode.value === 'collapsed')

const chips = computed(() => cardChips(props.session))
const meta = computed(() => railMeta(props.session))

const chipsId = computed(() => `sb-row-chips-${props.session.id}`)
const metaId = computed(() => `sb-row-meta-${props.session.id}`)
const describedBy = computed(() => {
  const ids = []
  if (chips.value.length) ids.push(chipsId.value)
  ids.push(metaId.value)
  return ids.join(' ')
})

const tooltip = computed(() => {
  const topic = props.session.topic || 'Untitled'
  const parts = chips.value.map((c) => (c.type === 'focus' ? `Focus: ${c.label}` : c.label))
  return parts.length ? `${topic} — ${parts.join(', ')}` : topic
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
    // F-44: the summary dialog lives in SessionView; ending from anywhere
    // else would silently drop the pending summary. Toast it instead.
    const s = store.pendingSummary
    const onThatSession =
      route.name === 'session' && route.params.id === props.session.id
    if (s && s.sessionId === props.session.id && !onThatSession) {
      showSuccess(s.text)
      store.consumePendingSummary()
    }
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

async function onContinueTopic() {
  if (busy.value) return
  busy.value = true
  try {
    const created = await store.continueTopic(props.session)
    if (created) router.push({ name: 'session', params: { id: created.id } })
    closeDrawer()
  } catch {
    /* F-06: store.error populated; without this the rethrow is unhandled */
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

async function startRename() {
  draft.value = props.session.topic || ''
  renaming.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function cancelRename() {
  const id = props.session.id
  draft.value = props.session.topic || ''
  renaming.value = false
  refocusRowTrigger(id)
}

async function commitRename() {
  if (!renaming.value) return
  const next = draft.value.trim()
  renaming.value = false
  if (!next || next === (props.session.topic || '')) return
  try { await store.renameSession(props.session.id, next) } catch { /* store.error populated */ }
}

function commitRenameFromKey() {
  const id = props.session.id
  commitRename()
  refocusRowTrigger(id)
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
      :aria-describedby="!isCollapsed && !renaming ? describedBy : undefined"
      :title="isCollapsed ? tooltip : ''"
      data-testid="sidebar-row-open"
      @click="openSession"
    >
      <span class="sb-row-dot" :class="{ 'sb-row-dot--filled': isCurrent }" aria-hidden="true" />
      <span v-if="!isCollapsed" class="sb-row-body">
        <input
          v-if="renaming"
          ref="inputEl"
          v-model="draft"
          type="text"
          class="sb-row-rename-input"
          aria-label="Rename session"
          data-testid="sidebar-row-rename-input"
          @keydown.enter.prevent="commitRenameFromKey"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
          @click.stop
        />
        <span v-else class="sb-row-topic">
          <i v-if="session.pinned && !session.ended_at" class="pi pi-bookmark-fill sb-row-pin" aria-hidden="true" />
          {{ session.topic || 'Untitled' }}
        </span>
        <SessionChips
          v-if="chips.length && !renaming"
          :id="chipsId"
          class="sb-row-chips"
          :chips="chips"
          variant="rail"
        />
        <span v-if="!renaming" :id="metaId" class="sb-row-meta">{{ meta }}</span>
      </span>
    </button>
    <SidebarRowMenu
      v-if="!isCollapsed"
      :state="state"
      :busy="busy"
      :pinned="session.pinned ?? false"
      @end="onEnd"
      @resume="onResume"
      @continue-topic="onContinueTopic"
      @pin="onPin"
      @unpin="onUnpin"
      @rename="startRename"
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
  padding: 0.4375rem 0.5rem 0.4375rem 0.75rem;
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
  gap: 0.0625rem;
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

.sb-row-chips {
  margin-top: 0.0625rem;
}

.sb-row--ended .sb-row-chips {
  opacity: 0.75;
}

.sb-row--current .sb-row-topic {
  font-weight: 600;
}

.sb-row-meta {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
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

.sb-row-rename-input {
  width: 100%;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.125rem 0.375rem;
}

.sb-row-pin {
  font-size: 0.75rem;
  color: var(--color-accent-text);
  margin-right: 0.25rem;
}
</style>

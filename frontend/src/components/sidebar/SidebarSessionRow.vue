<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSidebar } from '@/composables/useSidebar.js'
import { useSessionStore } from '@/stores/session.js'
import { useToast } from '@/composables/useToast.js'
import { levelStroke } from '@/components/chat/levelMark.js'
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
const { showSuccess, showError } = useToast()

const busy = ref(false)

const renaming = ref(false)
const draft = ref('')
const inputEl = ref(null)

const isCurrent = computed(() => route.params.id === props.session.id)
const isCollapsed = computed(() => mode.value === 'collapsed')

const tooltip = computed(() => props.session.topic || 'Untitled')

// Row label cells. SessionListItem.progress carries focus_target_gap, level,
// and mastered_count, so a row reads: topic, level mark, mastered count, focus
// cue underneath.
const masteredCount = computed(() => props.session.progress?.mastered_count || 0)
const focusCue = computed(() => props.session.progress?.focus_target_gap || '')
const level = computed(() => props.session.progress?.level || null)

const rowLabel = computed(() => {
  const parts = [`Open session: ${props.session.topic || 'Untitled'}`]
  if (level.value) parts.push(`level ${level.value}`)
  if (focusCue.value) parts.push(`focus ${focusCue.value}`)
  if (masteredCount.value) parts.push(`${masteredCount.value} mastered`)
  return parts.join(', ')
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
    const onThatSession = route.name === 'session' && route.params.id === props.session.id
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
  store.setPinned(id, true).catch(() => showError('Could not pin the session.'))
  refocusRowTrigger(id)
}

function onUnpin() {
  const id = props.session.id
  store.setPinned(id, false).catch(() => showError('Could not unpin the session.'))
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
  try {
    await store.renameSession(props.session.id, next)
  } catch {
    showError('Could not rename the session.')
  }
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
      :aria-label="rowLabel"
      :title="isCollapsed ? tooltip : ''"
      data-testid="sidebar-row-open"
      @click="openSession"
    >
      <span v-if="isCollapsed" class="sb-row-mark" aria-hidden="true" />
      <span v-else class="sb-row-body">
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
        <template v-else>
          <span class="sb-row-label">
            <span class="sb-row-topic">
              <svg
                v-if="session.pinned && !session.ended_at"
                class="sb-row-pin"
                viewBox="0 0 20 20"
                width="12"
                height="12"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M6 3.5 H14 V16.5 L10 13.5 L6 16.5 Z" />
              </svg>
              {{ session.topic || 'Untitled' }}
            </span>
            <span v-if="level" class="sb-row-level" aria-hidden="true">
              <svg
                class="sb-row-level-icon"
                viewBox="0 0 24 24"
                width="14"
                height="10"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                focusable="false"
              >
                <path d="M2 17 L22 7" :stroke-width="levelStroke(level)" />
              </svg>
            </span>
            <span v-if="masteredCount" class="sb-row-mastered" data-tabular aria-hidden="true">
              <svg
                class="sb-row-mastered-icon"
                viewBox="0 0 12 12"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                focusable="false"
              >
                <path d="M2 6.5 L4.8 9.2 L10 3.2" />
              </svg>
              {{ masteredCount }}
            </span>
          </span>
          <span v-if="focusCue" class="sb-row-focus" aria-hidden="true">{{ focusCue }}</span>
        </template>
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
/* A row is a ruled line on the contents page: no card, no radius, no fill.
   Height is a whole multiple of the pitch so every row sits on a rule. */
.sb-row {
  position: relative;
  display: flex;
  align-items: stretch;
  padding: 0;
  margin: 0;
  list-style: none;
}

.sb-row:hover,
.sb-row:focus-within {
  background: var(--color-surface-soft);
}

.sb-row:hover :deep(.sb-row-menu-trigger),
.sb-row:focus-within :deep(.sb-row-menu-trigger) {
  opacity: 1;
}

.sb-row-button {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: var(--line-pitch);
  padding: 0 0.25rem 0 0.75rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text);
}

.sb-row-button:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: -2px;
  border-radius: 0;
}

.sb-row-body {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Line one: topic, then the mastered count in pencil. */
.sb-row-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  line-height: var(--line-pitch);
}

.sb-row-topic {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  font-weight: 400;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sb-row-level {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}

.sb-row-level-icon {
  flex-shrink: 0;
  color: var(--pencil);
}

.sb-row-mastered {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  font-size: var(--fs-label);
  color: var(--pencil);
}

.sb-row-mastered-icon {
  flex-shrink: 0;
  color: var(--ink-learner);
}

/* Line two: the focus cue, in ink and marked in red, never set in red. */
.sb-row-focus {
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.sb-row--ended .sb-row-topic {
  color: var(--pencil);
}

.sb-row--current .sb-row-topic {
  font-weight: 700;
}

/* Collapsed rail: the row is a short pencil stroke; current turns blue. */
.sb-row--collapsed {
  justify-content: center;
}

.sb-row--collapsed .sb-row-button {
  align-items: center;
  justify-content: center;
  padding: 0;
}

.sb-row-mark {
  width: 1rem;
  height: 2px;
  background: var(--pencil);
}

.sb-row--ended .sb-row-mark {
  background: var(--rule-strong);
}

.sb-row--current .sb-row-mark {
  background: var(--ink-learner);
}

/* Renaming writes on the same rule the row sits on. */
.sb-row-rename-input {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--ink-learner);
  border-radius: 0;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.9375rem;
  line-height: calc(var(--line-pitch) - 1px);
  padding: 0;
}

.sb-row-rename-input:focus-visible {
  outline: none;
  border-bottom-width: 2px;
}

.sb-row-pin {
  flex-shrink: 0;
  vertical-align: middle;
  color: var(--pencil);
  margin-right: 0.25rem;
}
</style>

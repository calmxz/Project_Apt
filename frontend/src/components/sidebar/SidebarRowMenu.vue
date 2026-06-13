<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  /** 'active' | 'ended' — controls which action is offered */
  state: { type: String, required: true },
  /** Disable while async store action in flight */
  busy: { type: Boolean, default: false },
  /** Whether this session is currently pinned */
  pinned: { type: Boolean, default: false },
})

const emit = defineEmits(['end', 'resume', 'rename', 'pin', 'unpin'])

const open = ref(false)
const triggerEl = ref(null)
const popoverEl = ref(null)

function toggle() {
  if (props.busy) return
  open.value = !open.value
}

function close() {
  open.value = false
}

function onAction(kind) {
  if (props.busy) return
  if (kind === 'end') emit('end')
  else if (kind === 'resume') emit('resume')
  else if (kind === 'rename') emit('rename')
  else if (kind === 'pin') emit('pin')
  else if (kind === 'unpin') emit('unpin')
  close()
  triggerEl.value?.focus()
}

function onDocPointerDown(e) {
  if (!open.value) return
  if (popoverEl.value?.contains(e.target)) return
  if (triggerEl.value?.contains(e.target)) return
  close()
}

function onKey(e) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
    triggerEl.value?.focus()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div class="sb-row-menu" @click.stop>
    <button
      ref="triggerEl"
      type="button"
      class="sb-row-menu-trigger"
      :class="{ 'is-open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="state === 'active' ? 'Session actions' : 'Ended session actions'"
      :disabled="busy"
      data-testid="sidebar-row-menu-trigger"
      @click="toggle"
    >
      <i class="pi pi-ellipsis-h" aria-hidden="true" />
    </button>
    <div
      v-if="open"
      ref="popoverEl"
      class="sb-row-menu-popover"
      role="menu"
      data-testid="sidebar-row-menu-popover"
    >
      <button
        type="button"
        role="menuitem"
        class="sb-row-menu-item"
        data-testid="sidebar-row-menu-rename"
        :disabled="busy"
        @click="onAction('rename')"
      >
        <i class="pi pi-pencil" aria-hidden="true" /><span>Rename</span>
      </button>
      <button
        v-if="state === 'active'"
        type="button"
        role="menuitem"
        class="sb-row-menu-item"
        data-testid="sidebar-row-menu-pin"
        :disabled="busy"
        @click="onAction(pinned ? 'unpin' : 'pin')"
      >
        <i :class="pinned ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'" aria-hidden="true" />
        <span>{{ pinned ? 'Unpin' : 'Pin' }}</span>
      </button>
      <button
        v-if="state === 'active'"
        type="button"
        role="menuitem"
        class="sb-row-menu-item sb-row-menu-item--danger"
        data-testid="sidebar-row-menu-end"
        :disabled="busy"
        @click="onAction('end')"
      >
        <i class="pi pi-flag" aria-hidden="true" />
        <span>End session</span>
      </button>
      <button
        v-else-if="state === 'ended'"
        type="button"
        role="menuitem"
        class="sb-row-menu-item"
        data-testid="sidebar-row-menu-resume"
        :disabled="busy"
        @click="onAction('resume')"
      >
        <i class="pi pi-refresh" aria-hidden="true" />
        <span>Resume</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sb-row-menu {
  position: relative;
  flex-shrink: 0;
}

.sb-row-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.875rem;
  opacity: 0;
  transition: opacity var(--motion-fast) ease, background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.sb-row-menu-trigger.is-open,
.sb-row-menu-trigger:focus-visible,
.sb-row-menu-trigger:hover {
  opacity: 1;
  background: var(--color-surface-soft);
  color: var(--color-text);
}

/* On touch / coarse-pointer devices there is no hover to reveal the trigger, so
   keep it visible — otherwise Rename/Pin/End are unreachable (a row tap just
   navigates). Fine pointers keep the opacity:0-until-hover behavior above. */
@media (hover: none) {
  .sb-row-menu-trigger {
    opacity: 1;
  }
}

.sb-row-menu-trigger:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-row-menu-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.sb-row-menu-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 0.25rem);
  z-index: 40;
  min-width: 10rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lift);
  padding: 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.sb-row-menu-item {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border: 0;
  background: transparent;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.sb-row-menu-item:hover:not(:disabled) {
  background: var(--color-surface-soft);
}

.sb-row-menu-item:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-row-menu-item:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.sb-row-menu-item--danger {
  color: var(--color-error-text);
}

.sb-row-menu-item--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error-text);
}
</style>

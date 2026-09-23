<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  /** Display name; the parent falls back to the email when none is set. */
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  /** Folded rail: the circle alone, and the menu lifts out to the rail's right. */
  collapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['account', 'sign-out'])

const open = ref(false)
const triggerEl = ref(null)
const popoverEl = ref(null)
const fixedStyle = ref(null)
const menuId = `sb-user-menu-${useId()}`

const initial = computed(() => {
  const source = (props.name || '').trim() || (props.email || '').trim()
  // Array.from splits by code point, so a leading astral character (emoji,
  // rarer CJK) stays whole rather than yielding half a surrogate pair.
  return Array.from(source)[0]?.toUpperCase() ?? '?'
})

const displayName = computed(() => props.name || props.email || '')

function menuItems() {
  return popoverEl.value ? Array.from(popoverEl.value.querySelectorAll('[role="menuitem"]')) : []
}

// The sidebar clips its overflow, and the folded rail is narrower than the
// card. Folded, the popover is teleported to <body> and pinned beside the
// rail's right edge, bottom-aligned with the trigger.
function placeFixed() {
  const trigger = triggerEl.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const rail = trigger.closest('aside')?.getBoundingClientRect()
  const left = (rail ? rail.right : rect.right) + 4
  fixedStyle.value = {
    left: `${left}px`,
    bottom: `${Math.max(0, window.innerHeight - rect.bottom)}px`,
  }
}

async function openMenu(focusLast = false) {
  if (props.collapsed) placeFixed()
  open.value = true
  await nextTick()
  const items = menuItems()
  items[focusLast ? items.length - 1 : 0]?.focus()
}

function close() {
  open.value = false
}

function focusTrigger() {
  triggerEl.value?.focus()
}

function closeAndReturn() {
  close()
  focusTrigger()
}

function toggle() {
  if (open.value) closeAndReturn()
  else openMenu()
}

// Menu button pattern: ArrowDown and Enter open on the first item, ArrowUp
// on the last. Space is left to the native button click, which opens on the
// first item through toggle().
function onTriggerKeydown(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) openMenu(e.key === 'ArrowUp')
  } else if (e.key === 'Enter') {
    // Cancelling Enter's default also cancels its synthetic click.
    e.preventDefault()
    toggle()
  }
}

function onMenuKeydown(e) {
  const items = menuItems()
  if (!items.length) return
  const idx = items.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    items[(idx + 1) % items.length].focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    items[(idx - 1 + items.length) % items.length].focus()
  } else if (e.key === 'Home') {
    e.preventDefault()
    items[0].focus()
  } else if (e.key === 'End') {
    e.preventDefault()
    items[items.length - 1].focus()
  } else if (e.key === 'Tab') {
    // Leave the menu from its trigger so Tab carries on through the sidebar
    // even when the card is teleported to the end of <body>. The default is
    // cancelled so this Tab cannot slip past the mobile drawer's focus trap;
    // the next Tab moves on from the trigger as usual.
    e.preventDefault()
    closeAndReturn()
  }
}

function onAction(kind) {
  emit(kind)
  closeAndReturn()
}

function onDocPointerDown(e) {
  if (!open.value) return
  if (popoverEl.value?.contains(e.target)) return
  if (triggerEl.value?.contains(e.target)) return
  // Outside click: focus follows the pointer, so it is not pulled back.
  close()
}

function onKey(e) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeAndReturn()
  }
}

// Closing while focus is inside the menu would drop it to <body>; hand it
// back to the trigger once the menu is gone.
function closeKeepingFocus() {
  const hadFocus = popoverEl.value?.contains(document.activeElement)
  close()
  if (hadFocus) nextTick(focusTrigger)
}

// Only the folded, fixed-position card is pinned to viewport coordinates;
// the in-flow card follows the layout on its own.
function onViewportChange() {
  if (props.collapsed) closeKeepingFocus()
}

// Keydown listens on window in the capture phase, which runs before the
// mobile drawer's document-capture handler, so stopping Escape here closes
// only the menu and leaves the drawer open.
function addDocListeners() {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onViewportChange)
}

function removeDocListeners() {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', onViewportChange)
}

watch(open, (isOpen) => {
  if (isOpen) addDocListeners()
  else removeDocListeners()
})

// Folding or unfolding with the menu open would leave it anchored to the
// old layout; close it instead.
watch(
  () => props.collapsed,
  () => closeKeepingFocus(),
)

onBeforeUnmount(removeDocListeners)

defineExpose({ focusTrigger })
</script>

<template>
  <div class="sb-user" :class="{ 'sb-user--collapsed': collapsed }">
    <button
      ref="triggerEl"
      type="button"
      class="sb-user-trigger hit-44 coarse-2x"
      :class="{ 'is-open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :aria-label="`Account menu for ${displayName}`"
      :title="displayName"
      data-testid="sidebar-user-trigger"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="sb-avatar" aria-hidden="true" data-testid="sidebar-user-initial">{{
        initial
      }}</span>
      <span v-if="!collapsed" class="sb-user-name" data-testid="sidebar-user-name">{{
        displayName
      }}</span>
    </button>
    <Teleport to="body" :disabled="!collapsed">
      <div
        v-if="open"
        ref="popoverEl"
        class="sb-user-menu"
        :class="{ 'sb-user-menu--fixed': collapsed }"
        :style="collapsed ? fixedStyle : null"
        data-testid="sidebar-user-menu"
        @keydown="onMenuKeydown"
      >
        <div class="sb-user-menu-head">
          <span class="sb-user-menu-name" data-testid="sidebar-user-menu-name">{{
            displayName
          }}</span>
          <span v-if="email" class="sb-user-menu-email" data-testid="sidebar-user-menu-email">{{
            email
          }}</span>
        </div>
        <div class="sb-user-menu-rule" role="separator" />
        <div
          :id="menuId"
          role="menu"
          :aria-label="`Account menu for ${displayName}`"
          class="sb-user-menu-list"
          data-testid="sidebar-user-menu-list"
        >
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="sb-user-menu-item"
            data-testid="sidebar-user-menu-account"
            @click="onAction('account')"
          >
            Account
          </button>
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="sb-user-menu-item"
            data-testid="sidebar-sign-out"
            @click="onAction('sign-out')"
          >
            Sign out
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sb-user {
  position: relative;
  display: flex;
}

.sb-user--collapsed {
  justify-content: center;
}

/* The identity row: a written line in the foot, the same measure as Settings. */
.sb-user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  min-height: var(--line-pitch);
  padding: 0.25rem 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: color var(--motion-fast) ease;
}

.sb-user--collapsed .sb-user-trigger {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  justify-content: center;
}

.sb-user-trigger:hover,
.sb-user-trigger.is-open {
  color: var(--ink-learner);
}

.sb-user-trigger:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: 2px;
}

/* The one permitted mark of a person, and only in the shell. */
.sb-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--card);
  border: 1px solid var(--card-edge);
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: 1;
}

.sb-user-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
}

/* An overlay is the one thing allowed to lift off the page. */
.sb-user-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 0.25rem);
  z-index: 40;
  min-width: 12rem;
  background: var(--color-surface-raised);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lift);
  padding: 0.25rem 0;
  display: flex;
  flex-direction: column;
}

.sb-user-menu--fixed {
  position: fixed;
  right: auto;
  max-width: 16rem;
}

.sb-user-menu-head {
  display: flex;
  flex-direction: column;
  padding: 0.25rem 0.75rem 0.375rem;
  min-width: 0;
}

.sb-user-menu-name,
.sb-user-menu-email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
}

.sb-user-menu-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--color-text);
}

.sb-user-menu-email {
  font-size: var(--fs-caption);
  color: var(--pencil);
}

.sb-user-menu-rule {
  height: 0;
  margin: 0 0 0.25rem;
  border-top: 1px solid var(--rule);
}

.sb-user-menu-list {
  display: flex;
  flex-direction: column;
}

.sb-user-menu-item {
  display: flex;
  align-items: center;
  padding: 0 0.75rem;
  min-height: var(--line-pitch);
  border: 0;
  border-radius: 0;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  transition: background var(--motion-fast) ease;
}

.sb-user-menu-item:hover {
  background: var(--color-surface-soft);
}

.sb-user-menu-item:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: -2px;
  border-radius: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sb-user-trigger,
  .sb-user-menu-item {
    transition: none;
  }
}
</style>

<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps({
  /** Display name; empty when the learner has not set one. */
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  /** Folded rail: the circle alone, with the name as its tooltip. */
  collapsed: { type: Boolean, default: false },
})

// The name, else the email's local part: the row never shows a full address.
const displayName = computed(
  () => (props.name || '').trim() || (props.email || '').trim().split('@')[0],
)

const initial = computed(() => {
  // Array.from splits by code point, so a leading astral character (emoji,
  // rarer CJK) stays whole rather than yielding half a surrogate pair.
  return Array.from(displayName.value)[0]?.toUpperCase() ?? '?'
})
</script>

<template>
  <div class="sb-user" :class="{ 'sb-user--collapsed': collapsed }">
    <!-- One click on the avatar or the name opens Settings; Account and Sign
         out live there. -->
    <RouterLink
      to="/settings"
      class="sb-user-trigger hit-44 coarse-2x"
      :aria-label="`Settings for ${displayName}`"
      :title="displayName"
      data-testid="sidebar-user-trigger"
    >
      <span class="sb-avatar" aria-hidden="true" data-testid="sidebar-user-initial">{{
        initial
      }}</span>
      <span v-if="!collapsed" class="sb-user-name" data-testid="sidebar-user-name">{{
        displayName
      }}</span>
    </RouterLink>
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
  text-decoration: none;
  cursor: pointer;
  transition: color var(--motion-fast) ease;
}

.sb-user--collapsed .sb-user-trigger {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  justify-content: center;
}

.sb-user-trigger:hover {
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

@media (prefers-reduced-motion: reduce) {
  .sb-user-trigger {
    transition: none;
  }
}
</style>

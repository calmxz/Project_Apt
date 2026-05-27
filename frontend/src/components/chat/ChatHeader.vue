<template>
  <div class="nav-session">
    <span class="folio" :class="{ 'is-archived': isEnded }">
      {{ isEnded ? 'archived' : 'in session' }}
    </span>
    <h1 class="topic">{{ session?.topic || 'Session' }}</h1>
    <div class="head-actions">
      <router-link
        :to="{ name: 'session-profile', params: { id } }"
        class="profile-link profile-link-compact"
        data-testid="session-profile-link"
        aria-label="View this session's profile"
      >
        <i class="pi pi-id-card" aria-hidden="true" />
        <span class="action-label">Profile</span>
      </router-link>
      <Button
        v-if="!isEnded"
        label="End session"
        icon="pi pi-flag"
        icon-pos="right"
        severity="secondary"
        data-testid="session-end"
        :disabled="!canEnd"
        class="end-btn"
        @click="$emit('end-session')"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'

const props = defineProps({
  // Nullable: SessionView renders the header before loadSession resolves, so
  // session is null during the initial load. canEnd gates the End button off
  // until it arrives.
  session: { type: Object, default: null },
  id: { type: String, required: true },
})

defineEmits(['end-session'])

const isEnded = computed(() => Boolean(props.session?.ended_at))
const canEnd = computed(() => Boolean(props.session && !props.session.ended_at))
</script>

<style scoped>
/* Rendered inside the global navbar (teleported from SessionView). Lays out as
   a single inline row: status badge + topic title left, actions pushed right. */
.nav-session {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 0;
}

.folio {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  padding: 0.2rem 0.55rem;
  border-radius: var(--radius-pill);
  line-height: 1.25;
  white-space: nowrap;
}

.folio.is-archived {
  color: var(--color-text-muted);
  background: var(--color-surface-soft);
}

.topic {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--font-display);
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  line-height: 1.2;
  color: var(--color-heading);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
}

/* Header action buttons */
.end-btn :deep(.p-button),
.end-btn.p-button {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.end-btn :deep(.p-button):not(:disabled):hover {
  color: var(--signal-error);
  border-color: var(--signal-error);
  background: rgba(239, 68, 68, 0.08);
  transform: translateY(-1px);
}

/* Tight navbars: drop the status badge first, then the action labels, so the
   title still fits beside the global nav icons. */
@media (max-width: 720px) {
  .folio { display: none; }
}

@media (max-width: 560px) {
  .action-label { display: none; }
}
</style>

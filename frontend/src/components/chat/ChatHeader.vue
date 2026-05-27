<template>
  <header class="head">
    <div class="head-text">
      <div class="head-title-row">
        <span class="folio" :class="{ 'is-archived': isEnded }">{{ isEnded ? 'archived' : 'in session' }}</span>
        <h1 class="topic">{{ session?.topic || 'Session' }}</h1>
      </div>
      <p class="muted" data-testid="session-id">id · {{ id }}</p>
    </div>
    <div class="head-actions">
      <router-link
        :to="{ name: 'session-profile', params: { id } }"
        class="profile-link profile-link-compact"
        data-testid="session-profile-link"
        aria-label="View this session's profile"
      >
        <i class="pi pi-id-card" aria-hidden="true" />
        <span>Profile</span>
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
  </header>
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
.head {
  position: sticky;
  top: var(--topnav-h, 4.75rem);
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem 0;
  /* Opaque page-colored bar so messages scroll cleanly underneath it. */
  background: var(--color-background);
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.head-title-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
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
  font-family: var(--font-display);
  font-size: clamp(1.375rem, 2.5vw, 1.625rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.15;
  color: var(--color-heading);
  margin: 0;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.muted {
  color: var(--color-text-faint);
  margin: 0;
  max-width: 100%;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
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
</style>

<template>
  <header class="head">
    <div class="head-text">
      <span class="folio">{{ isEnded ? 'archived' : 'in session' }}</span>
      <h1 class="topic">{{ session?.topic || 'Session' }}</h1>
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
  session: { type: Object, required: true },
  id: { type: String, required: true },
})

defineEmits(['end-session'])

const isEnded = computed(() => Boolean(props.session?.ended_at))
const canEnd = computed(() => Boolean(props.session && !props.session.ended_at))
</script>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent);
}

.topic {
  font-family: var(--font-display);
  font-size: clamp(1.875rem, 4vw, 2.25rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  color: var(--color-heading);
  margin: 0;
  overflow-wrap: anywhere;
}

.muted {
  color: var(--color-text-faint);
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  letter-spacing: 0.04em;
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

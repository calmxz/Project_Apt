<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'

const props = defineProps({
  match: { type: Object, required: true },
  kind: { type: String, required: true, validator: (v) => ['active', 'ended'].includes(v) },
  busy: { type: Boolean, default: false },
})
defineEmits(['open-existing', 'continue-topic', 'start-fresh', 'cancel'])

const gapLine = computed(() =>
  props.kind === 'ended' && props.match.gap_count > 0
    ? `${props.match.gap_count} ${props.match.gap_count === 1 ? 'gap' : 'gaps'} open`
    : '',
)

const primaryBtn = ref(null)

onMounted(async () => {
  await nextTick()
  primaryBtn.value?.focus()
})
</script>

<template>
  <div
    class="intercept"
    data-testid="start-intercept"
    role="status"
    aria-live="polite"
    aria-label="Existing session found"
  >
    <button
      type="button"
      class="intercept-cancel"
      data-testid="intercept-cancel"
      aria-label="Dismiss"
      :disabled="busy"
      @click="$emit('cancel')"
    >
      <i class="pi pi-times" aria-hidden="true" />
    </button>
    <p v-if="kind === 'active'" class="intercept-line">
      You have an active session on <strong>"{{ match.title }}"</strong>.
    </p>
    <p v-else class="intercept-line">
      You studied <strong>"{{ match.title }}"</strong> before<template v-if="gapLine">
        ({{ gapLine }})</template
      >.
    </p>
    <div class="intercept-actions">
      <button
        v-if="kind === 'active'"
        ref="primaryBtn"
        type="button"
        class="intercept-primary"
        data-testid="intercept-open-existing"
        :disabled="busy"
        @click="$emit('open-existing')"
      >
        Open it
      </button>
      <button
        v-else
        ref="primaryBtn"
        type="button"
        class="intercept-primary"
        data-testid="intercept-continue"
        :disabled="busy"
        @click="$emit('continue-topic')"
      >
        Continue where you left off
      </button>
      <button
        type="button"
        class="intercept-secondary"
        data-testid="intercept-fresh"
        :disabled="busy"
        @click="$emit('start-fresh')"
      >
        Start fresh
      </button>
    </div>
  </div>
</template>

<style scoped>
.intercept {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.875rem 2.25rem 0.875rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.intercept-line {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.intercept-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.intercept-primary,
.intercept-secondary {
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    border-color var(--motion-fast) ease;
}

.intercept-primary {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  border: 1px solid var(--color-accent);
}

.intercept-secondary {
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.intercept-cancel {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.intercept-primary:disabled,
.intercept-secondary:disabled,
.intercept-cancel:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>

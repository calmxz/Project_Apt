<template>
  <button
    type="button"
    class="back-btn"
    :class="{ 'is-icon-only': iconOnly }"
    data-testid="back-button"
    :aria-label="label"
    :title="iconOnly ? label : null"
    @click="onClick"
  >
    <span class="arrow" aria-hidden="true">&larr;</span>
    <span v-if="!iconOnly" class="label">{{ label }}</span>
  </button>
</template>

<script setup>
import { useRouter } from 'vue-router'

const props = defineProps({
  label: { type: String, default: 'Back' },
  fallback: { type: String, default: '/' },
  iconOnly: { type: Boolean, default: false },
})

const router = useRouter()

function onClick() {
  // window.history.state is null on a fresh tab; in that case router.back() is a no-op.
  if (window.history.length > 1 && window.history.state?.back) {
    router.back()
  } else {
    router.push(props.fallback)
  }
}
</script>

<style scoped>
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: 0;
  padding: 0.375rem 0.5rem;
  margin: 0 0 0.75rem -0.5rem;
  cursor: pointer;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  transition: color 180ms ease, background 180ms ease;
}

.back-btn.is-icon-only {
  margin: 0;
  padding: 0.375rem;
  gap: 0;
}

.back-btn:hover,
.back-btn:focus-visible {
  color: var(--color-heading);
  background: var(--color-surface-soft);
  outline: none;
}

.arrow {
  font-size: 1.05rem;
  line-height: 1;
}
</style>

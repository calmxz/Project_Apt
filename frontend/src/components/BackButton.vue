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
    <i class="pi pi-arrow-left arrow" aria-hidden="true" />
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
/* A plain blue back line, not a labelled control block. */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  border-radius: var(--radius-sm);
}

.back-btn:hover .label {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.back-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.arrow {
  font-size: 0.875rem;
  line-height: 1;
}
</style>

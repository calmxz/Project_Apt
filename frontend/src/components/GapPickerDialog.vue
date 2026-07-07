<template>
  <Dialog
    :visible="visible"
    modal
    header="Which gap should we review?"
    :style="{ width: '24rem' }"
    data-testid="gap-picker"
    @update:visible="$emit('update:visible', $event)"
  >
    <ul class="gap-list" role="listbox" aria-label="Confirmed gaps">
      <li v-for="(g, i) in gaps" :key="g">
        <button
          type="button"
          class="gap-option"
          role="option"
          :data-testid="`gap-picker-option-${i}`"
          @click="choose(g)"
        >
          <i class="pi pi-bullseye" aria-hidden="true" />
          <span>{{ g }}</span>
        </button>
      </li>
    </ul>
  </Dialog>
</template>

<script setup>
import Dialog from 'primevue/dialog'

defineProps({
  visible: { type: Boolean, default: false },
  gaps: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:visible', 'select'])

function choose(gap) {
  emit('select', gap)
  emit('update:visible', false)
}
</script>

<style scoped>
.gap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.gap-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.gap-option:hover {
  background: var(--color-surface-soft);
}

.gap-option:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

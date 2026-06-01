<script setup>
import { computed } from 'vue'
import { labelFor } from './toolLabels.js'

const props = defineProps({
  tool_call: { type: Object, required: true },
  state: {
    type: String,
    required: true,
    validator: (v) => ['running', 'done', 'error'].includes(v),
  },
})

const display = computed(() => {
  if (props.state === 'done' && props.tool_call.summary) {
    return props.tool_call.summary
  }
  return labelFor(props.tool_call.name, props.state)
})
</script>

<template>
  <span
    class="tool-pill"
    :class="`tool-pill--${state}`"
    :title="state === 'error' ? (tool_call.error || display) : undefined"
  >
    <span class="tool-pill-dot" aria-hidden="true"></span>
    <span class="tool-pill-text">{{ display }}</span>
  </span>
</template>

<style scoped>
.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--tool-pill-bg, rgba(255,107,91,0.08));
  border: 1px solid var(--tool-pill-border, rgba(255,107,91,0.2));
  color: var(--tool-pill-text, #c44);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  line-height: 1.2;
}
.tool-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.tool-pill--running .tool-pill-dot {
  animation: tool-pill-pulse 1s ease-in-out infinite;
}
.tool-pill--error {
  background: var(--color-surface-soft);
  border-color: var(--color-border);
  color: var(--color-text-muted, #888);
}
@keyframes tool-pill-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>

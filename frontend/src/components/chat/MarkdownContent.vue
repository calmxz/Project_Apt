<script setup>
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdownRenderer.js'
import { splitSafePrefix } from '@/lib/markdownStreamBuffer.js'

const props = defineProps({
  text: { type: String, required: true },
  streaming: { type: Boolean, default: false },
})

const parts = computed(() => {
  if (!props.streaming) {
    return { safeHtml: renderMarkdown(props.text), deferred: '' }
  }
  const { safe, deferred } = splitSafePrefix(props.text)
  return { safeHtml: renderMarkdown(safe), deferred }
})
</script>

<template>
  <div class="markdown-content">
    <div class="md-rendered" v-html="parts.safeHtml"></div>
    <span v-if="parts.deferred" class="deferred">{{ parts.deferred }}</span>
  </div>
</template>

<style scoped>
.markdown-content { line-height: 1.6; }
/* Rendered markdown is real HTML; reset any inherited white-space: pre-wrap
   so inter-tag newlines don't render as blank lines. The deferred tail keeps
   pre-wrap (set below) for faithful streaming display. */
.md-rendered { white-space: normal; }
.md-rendered :deep(p) { margin: 0 0 0.6em 0; }
.md-rendered :deep(pre) {
  background: var(--code-block-bg, #f7f3ed);
  color: var(--code-block-text, #2c2316);
  border: 1px solid var(--code-block-border, rgba(0,0,0,0.06));
  border-radius: 8px;
  padding: 12px 14px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  overflow-x: auto;
}
.md-rendered :deep(code:not(pre code)) {
  background: #f4e9d8;
  color: #8a4a00;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}
.md-rendered :deep(.katex-display) {
  background: var(--math-bg, #fff8ed);
  border-left: 3px solid var(--math-accent, #ff6b5b);
  padding: 8px 12px;
  margin: 6px 0;
}
.md-rendered :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.md-rendered :deep(th), .md-rendered :deep(td) {
  border: 1px solid rgba(0,0,0,0.08);
  padding: 4px 8px;
}
.deferred {
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  color: var(--color-text-muted, #888);
}
</style>

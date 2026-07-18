<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { renderMarkdown } from '@/lib/markdownRenderer.js'
import {
  splitSafePrefixIncremental,
  createSplitState,
} from '@/lib/markdownStreamBuffer.js'

const props = defineProps({
  text: { type: String, required: true },
  streaming: { type: Boolean, default: false },
})

// Per-instance scan state; plain object on purpose (mutated by the split,
// never read by the template).
const splitState = createSplitState()

const parts = computed(() => {
  if (!props.streaming) {
    return { safeHtml: renderMarkdown(props.text), deferred: '' }
  }
  const { safe, deferred } = splitSafePrefixIncremental(props.text, splitState)
  return { safeHtml: renderMarkdown(safe), deferred }
})

// F-03: the fence renderer emits a [data-copy-button] per code block, but
// v-html markup can't carry handlers (DOMPurify strips inline ones), so the
// click is delegated from the component root.
let _copyResetTimer = null
onBeforeUnmount(() => clearTimeout(_copyResetTimer))

async function onRootClick(e) {
  const btn = e.target.closest?.('[data-copy-button]')
  if (!btn) return
  const code = btn.closest('pre')?.querySelector('code')
  if (!code || !navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(code.textContent)
  } catch {
    return // clipboard permission denied; leave the label unchanged
  }
  btn.textContent = 'copied'
  clearTimeout(_copyResetTimer)
  _copyResetTimer = setTimeout(() => {
    btn.textContent = 'copy'
  }, 1500)
}
</script>

<template>
  <div class="markdown-content" @click="onRootClick">
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

/* Bubble-tuned block rhythm: em-relative list indent + breathing between
   items, and headings sized to sit inside the bubble rather than as page
   titles. Trailing margins trimmed so the bubble hugs its content. */
.md-rendered :deep(ul), .md-rendered :deep(ol) {
  margin: 0 0 0.6em;
  padding-left: 1.35em;
}
.md-rendered :deep(li) { margin: 0 0 0.35em; }
.md-rendered :deep(li > p) { margin: 0; }
.md-rendered :deep(h1),
.md-rendered :deep(h2),
.md-rendered :deep(h3),
.md-rendered :deep(h4) {
  font-size: 1.05em;
  line-height: 1.3;
  margin: 0.5em 0 0.3em;
}
.md-rendered :deep(h1:first-child),
.md-rendered :deep(h2:first-child),
.md-rendered :deep(h3:first-child),
.md-rendered :deep(h4:first-child) { margin-top: 0; }
.md-rendered :deep(blockquote) {
  margin: 0 0 0.6em;
  padding-left: 0.9em;
  border-left: 3px solid var(--color-border);
  color: var(--color-text-muted);
}
.md-rendered :deep(> :last-child) { margin-bottom: 0; }
.md-rendered :deep(li:last-child) { margin-bottom: 0; }
.md-rendered :deep(pre) {
  background: var(--color-surface-soft);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.75rem 0.875rem;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  overflow-x: auto;
}
.md-rendered :deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
}
.md-rendered :deep(.code-block-copy) {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  border-radius: 3px;
  padding: 1px 8px;
  font: inherit;
  cursor: pointer;
}
.md-rendered :deep(.code-block-copy:hover),
.md-rendered :deep(.code-block-copy:focus-visible) {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}
.md-rendered :deep(code:not(pre code)) {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}
.md-rendered :deep(.katex-display) {
  background: var(--color-surface-soft);
  border-left: 3px solid var(--color-accent);
  padding: 8px 12px;
  margin: 6px 0;
}
.md-rendered :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.md-rendered :deep(th), .md-rendered :deep(td) {
  border: 1px solid var(--color-border);
  padding: 4px 8px;
}
.deferred {
  font-family: 'Consolas', 'Monaco', monospace;
  white-space: pre-wrap;
  color: var(--color-text-muted, #888);
}
</style>

<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { renderMarkdown } from '@/lib/markdownRenderer.js'
import { splitSafePrefixIncremental, createSplitState } from '@/lib/markdownStreamBuffer.js'

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
/* Every block snaps to the 28px pitch so the notes keep sitting on the rules. */
.markdown-content {
  line-height: var(--line-pitch);
}
/* Rendered markdown is real HTML; reset any inherited white-space: pre-wrap
   so inter-tag newlines don't render as blank lines. The deferred tail keeps
   pre-wrap (set below) for faithful streaming display. */
.md-rendered {
  white-space: normal;
}
.md-rendered :deep(p) {
  margin: 0 0 var(--line-pitch);
}

/* Block rhythm on the pitch: every margin is 28px or a whole fraction of it,
   so a paragraph, a list or a heading never knocks the text off the rules. */
.md-rendered :deep(ul),
.md-rendered :deep(ol) {
  margin: 0 0 var(--line-pitch);
  padding-left: 1.35em;
}
.md-rendered :deep(li) {
  margin: 0;
}
.md-rendered :deep(li > p) {
  margin: 0;
}
.md-rendered :deep(h1),
.md-rendered :deep(h2),
.md-rendered :deep(h3),
.md-rendered :deep(h4) {
  font-family: var(--font-display);
  font-size: var(--fs-h3);
  font-weight: 600;
  line-height: var(--line-pitch);
  margin: var(--line-pitch) 0 0;
}
.md-rendered :deep(h1:first-child),
.md-rendered :deep(h2:first-child),
.md-rendered :deep(h3:first-child),
.md-rendered :deep(h4:first-child) {
  margin-top: 0;
}
/* Quoted matter is set in, not fenced by a coloured side rule. */
.md-rendered :deep(blockquote) {
  margin: 0 0 var(--line-pitch);
  padding-left: 1.5em;
  color: var(--pencil);
  font-style: italic;
}
.md-rendered :deep(> :last-child) {
  margin-bottom: 0;
}
.md-rendered :deep(pre) {
  background: var(--color-surface-soft);
  color: var(--ink);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  padding: calc(var(--line-pitch) / 2) 0.875rem;
  margin: 0 0 var(--line-pitch);
  font-family: var(--font-mono);
  font-size: 0.9375rem;
  line-height: var(--line-pitch);
  overflow-x: auto;
}
.md-rendered :deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}
.md-rendered :deep(.code-block-copy) {
  border: 1px solid var(--rule-strong);
  background: transparent;
  color: var(--ink-learner);
  border-radius: var(--radius-sm);
  padding: 1px 8px;
  font: inherit;
  cursor: pointer;
}
.md-rendered :deep(.code-block-copy:hover),
.md-rendered :deep(.code-block-copy:focus-visible) {
  border-color: var(--ink-learner);
}
.md-rendered :deep(code:not(pre code)) {
  background: var(--color-surface-soft);
  color: var(--ink);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.md-rendered :deep(.katex-display) {
  margin: var(--line-pitch) 0;
  padding-bottom: calc(var(--line-pitch) / 2);
  border-bottom: 1px solid var(--rule-strong);
}
.md-rendered :deep(table) {
  border-collapse: collapse;
  margin: 0 0 var(--line-pitch);
}
.md-rendered :deep(th),
.md-rendered :deep(td) {
  border: 1px solid var(--rule-strong);
  padding: 0 0.75rem;
  line-height: var(--line-pitch);
  font-variant-numeric: tabular-nums;
}
.md-rendered :deep(th) {
  text-align: left;
  font-weight: 700;
}
.deferred {
  font-family: var(--font-mono);
  white-space: pre-wrap;
  color: var(--pencil);
}
</style>

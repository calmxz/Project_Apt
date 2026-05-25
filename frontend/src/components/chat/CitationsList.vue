<script setup>
import { computed } from 'vue'

const props = defineProps({
  citations: { type: Array, required: true },
})

const grouped = computed(() => {
  const map = new Map()
  for (const c of props.citations || []) {
    const key = c.doc_id
    const name = c.doc_name || c.doc_id
    if (!map.has(key)) map.set(key, { doc_id: key, doc_name: name, pages: [] })
    // Phase 1 citations are {doc_id, text} with no page; Phase 2 (Task 14)
    // extends the contract with page. Only show chips for real page numbers.
    if (c.page !== undefined && c.page !== null) map.get(key).pages.push(c.page)
  }
  return Array.from(map.values())
})
</script>

<template>
  <div v-if="grouped.length" class="citations-list">
    <div v-for="doc in grouped" :key="doc.doc_id" class="citation-doc">
      <span class="citation-doc-name">{{ doc.doc_name }}</span>
      <span v-if="doc.pages.length" class="citation-pages">
        <span v-for="(p, i) in doc.pages" :key="i" class="citation-page">p.{{ p }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.citations-list {
  border-top: 1px dashed rgba(0,0,0,0.15);
  margin-top: 10px;
  padding-top: 8px;
  font-size: 11px;
  color: var(--color-text-muted, #888);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.citation-doc { display: flex; gap: 8px; align-items: baseline; }
.citation-doc-name { font-weight: 600; }
.citation-pages { display: inline-flex; gap: 6px; }
</style>

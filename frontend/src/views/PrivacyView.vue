<template>
  <main class="legal-page">
    <div class="legal-head">
      <BackButton label="Back" fallback="/" />
    </div>
    <article class="legal" v-html="html" />
  </main>
</template>

<script setup>
import { renderMarkdown } from '@/lib/markdownRenderer.js'

import BackButton from '../components/BackButton.vue'
import source from '../legal/privacy-policy.md?raw'

const html = renderMarkdown(source)
</script>

<style scoped>
/* A white reading card, centred on the desk ground. */
.legal-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 48rem;
  margin: 1.75rem auto 3.5rem;
  padding: clamp(1.5rem, 4vw, 2.5rem);
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
}

.legal-head {
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--card-edge);
}

.legal {
  max-width: 72ch;
  padding-top: 1.5rem;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
}

.legal :deep(h1) {
  margin: 0 0 1.5rem;
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

/* One Display Line Rule: the display face stays on the h1; section headings
   are the Subhead in the body face. */
.legal :deep(h2) {
  margin: 1.75rem 0 0;
  font-family: var(--font-sans);
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-body);
  color: var(--ink);
}

.legal :deep(p),
.legal :deep(ul),
.legal :deep(ol) {
  margin: 0 0 1.5rem;
  line-height: var(--lh-body);
  color: var(--ink);
}

.legal :deep(ul),
.legal :deep(ol) {
  padding-left: 1.25rem;
}

.legal :deep(li) {
  line-height: var(--lh-body);
}

.legal :deep(li + li) {
  margin-top: 0;
}

.legal :deep(em) {
  font-style: italic;
  color: var(--pencil);
}

.legal :deep(strong) {
  font-weight: 700;
}

.legal :deep(a) {
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.legal :deep(a:hover) {
  color: var(--color-accent-hover);
}
</style>

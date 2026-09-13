<template>
  <section class="legal-page">
    <div class="legal-head">
      <BackButton label="Back" fallback="/" />
    </div>
    <article class="legal" v-html="html" />
  </section>
</template>

<script setup>
import { renderMarkdown } from '@/lib/markdownRenderer.js'

import BackButton from '../components/BackButton.vue'
import source from '../legal/privacy-policy.md?raw'

const html = renderMarkdown(source)
</script>

<style scoped>
/* A ruled reading column: the back line on its own rule, then the document
   set on the feint rules at the 28px pitch. No card, no chrome. */
.legal-page {
  box-sizing: border-box;
  width: 100%;
  max-width: calc(72ch + 2rem);
  margin: 0 auto;
  padding: var(--line-pitch) 1rem calc(var(--line-pitch) * 2);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
}

.legal-head {
  padding-bottom: calc(var(--line-pitch) - 1px);
  border-bottom: 1px solid var(--rule-strong);
}

.legal {
  max-width: 72ch;
  padding-top: var(--line-pitch);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
  background-image: var(--ruled-bg);
  background-position-y: var(--ruled-offset);
  background-attachment: local;
}

.legal :deep(h1) {
  margin: 0 0 var(--line-pitch);
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: calc(var(--line-pitch) * 2);
  color: var(--ink);
}

/* One Display Line Rule: the display face stays on the h1; section headings
   are the Subhead in the body face. */
.legal :deep(h2) {
  margin: var(--line-pitch) 0 0;
  font-family: var(--font-sans);
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.legal :deep(p),
.legal :deep(ul),
.legal :deep(ol) {
  margin: 0 0 var(--line-pitch);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.legal :deep(ul),
.legal :deep(ol) {
  padding-left: 1.25rem;
}

.legal :deep(li) {
  line-height: var(--line-pitch);
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

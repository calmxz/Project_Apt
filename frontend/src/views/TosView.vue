<template>
  <section class="legal-page">
    <BackButton label="Back" fallback="/" />
    <article class="legal" v-html="html" />
  </section>
</template>

<script setup>
import { renderMarkdown } from '@/lib/markdownRenderer.js'

import BackButton from '../components/BackButton.vue'
import source from '../legal/terms-of-service.md?raw'

const html = renderMarkdown(source)
</script>

<style scoped>
.legal-page {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}
.legal {
  margin-top: 1.5rem;
  line-height: var(--lh-body);
}
.legal :deep(h1) {
  font-family: var(--font-display);
  font-size: 2rem;
  letter-spacing: var(--tracking-tight);
  margin-bottom: 0.5rem;
}
.legal :deep(h2) {
  font-family: var(--font-display);
  font-size: 1.25rem;
  margin-top: 2rem;
  margin-bottom: 0.5rem;
}
.legal :deep(p),
.legal :deep(ul) {
  margin-bottom: 1rem;
  color: var(--color-text);
}
.legal :deep(ul) {
  padding-left: 1.25rem;
}
.legal :deep(li + li) {
  margin-top: 0.25rem;
}
@media (max-width: 600px) {
  .legal-page {
    padding: 1.25rem 1rem 3rem;
  }
}
</style>

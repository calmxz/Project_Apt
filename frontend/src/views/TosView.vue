<template>
  <article class="legal" v-html="html" />
</template>

<script setup>
import { renderMarkdown } from '@/lib/markdownRenderer.js'

import source from '../legal/terms-of-service.md?raw'

const html = renderMarkdown(source)
</script>

<style scoped>
.legal {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  line-height: var(--lh-body);
}
</style>

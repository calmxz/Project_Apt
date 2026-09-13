<template>
  <section class="not-found">
    <h1 class="title" data-testid="not-found-title">Page not found</h1>
    <p class="lede">Nothing is written at this address.</p>
    <p class="back">
      <RouterLink to="/" class="cta" data-testid="not-found-home">
        <span>Back home</span>
        <svg
          class="cta-mark"
          viewBox="0 0 20 20"
          width="18"
          height="18"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 10 L15 10 M10.5 5.5 L15 10 L10.5 14.5" />
        </svg>
      </RouterLink>
    </p>
  </section>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
/* A page from the same notebook: one display line, a pencil lede on the next
   rule, and the way back written in blue under it. No card, no fill. */
.not-found {
  max-width: 44rem;
  margin: 0 auto;
  padding: var(--line-pitch) 1rem;
  font-family: var(--font-sans);
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.25rem;
  font-weight: 600;
  line-height: calc(var(--line-pitch) * 2);
  letter-spacing: -0.01em;
  color: var(--ink);
}

.lede {
  margin: 0 0 var(--line-pitch);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.back {
  margin: 0;
  line-height: var(--line-pitch);
}

/* Written, not stamped: the page CTA is a line of blue text with a drawn
   arrow after the word. Only the word carries the underline. */
.cta {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  text-decoration: none;
  cursor: pointer;
}

.cta > span {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.cta:hover {
  color: var(--color-accent-hover);
}

.cta-mark {
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cta:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

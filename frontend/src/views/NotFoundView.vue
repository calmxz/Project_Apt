<template>
  <main class="not-found-page">
    <div class="not-found">
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
    </div>
  </main>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
/* A small card centred on the desk ground. */
.not-found-page {
  min-height: 100dvh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.75rem 1rem 3.5rem;
  background: var(--desk);
}

.not-found {
  width: 100%;
  max-width: 26rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  padding: clamp(1.5rem, 4vw, 2.5rem);
  font-family: var(--font-sans);
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.25rem;
  font-weight: 600;
  line-height: var(--lh-display);
  letter-spacing: -0.01em;
  color: var(--ink);
}

.lede {
  margin: 0 0 1.5rem;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.back {
  margin: 0;
  line-height: 1.75rem;
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
  line-height: 1.75rem;
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

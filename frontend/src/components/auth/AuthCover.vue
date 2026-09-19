<template>
  <main class="cover">
    <div class="sheet">
      <header class="cover-head">
        <Logo size="md" variant="full" />
        <h1 class="cover-title">{{ title }}</h1>
        <p class="cover-lede">{{ lede }}</p>
      </header>

      <slot />
    </div>
  </main>
</template>

<script setup>
// The shared cover: one white card on the desk ground, a logo, a title, a
// lede, and whatever form the view slots in. Every auth/onboarding cover
// draws the same card, so the card lives here once and the views keep only
// the rules their own extra elements need.
import Logo from '../Logo.vue'

defineProps({
  title: { type: String, required: true },
  lede: { type: String, required: true },
})
</script>

<style scoped>
/* One white card centred on the desk ground. */
.cover {
  min-height: 100dvh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.75rem 1rem 3.5rem;
  background: var(--desk);
}

.sheet {
  width: 100%;
  max-width: 26rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow:
    0 1px 0 var(--card-drop),
    var(--shadow-lift);
  padding: clamp(1.5rem, 4vw, 2.5rem);
}

.cover-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.cover-title {
  margin: 0.875rem 0 0;
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.cover-lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

/* Everything below styles slotted content, so it carries the slot scope id
   rather than this component's own. */
:slotted(.form) {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1.5rem;
}

/* A field is a label above a line the learner writes on. */
:slotted(.field) {
  display: flex;
  flex-direction: column;
}

:slotted(.field-label) {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: 1.75rem;
  color: var(--pencil);
}

:slotted(.field-line) {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
  gap: 0.5rem;
  border-bottom: 1px solid var(--card-edge);
  transition: border-color var(--motion-fast) ease;
}

:slotted(.field-line):focus-within {
  border-bottom-color: var(--ink-learner);
}

:slotted(.field-input) input,
:slotted(.field-input).p-inputtext {
  width: 100%;
  height: 1.75rem;
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  outline: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: 1.75rem;
  color: var(--ink-learner);
  caret-color: var(--ink-learner);
}

:slotted(.field-input) input:focus,
:slotted(.field-input).p-inputtext:focus {
  box-shadow: none;
  outline: 0;
  border: 0;
}

:slotted(.field-input) input::placeholder,
:slotted(.field-input).p-inputtext::placeholder {
  color: var(--pencil);
  opacity: 1;
}

/* Written, not stamped: the cover's action is a line of blue text with a
   drawn arrow after the word. Filled blue stays in dialog footers. */
:slotted(.actions) {
  display: flex;
}

:slotted(.cta) {
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
  cursor: pointer;
  transition: color var(--motion-fast) ease;
}

:slotted(.cta) > span {
  text-decoration: underline;
  text-underline-offset: 3px;
}

:slotted(.cta):not(:disabled):hover {
  color: var(--color-accent-hover);
}

:slotted(.cta):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

:slotted(.cta):disabled {
  color: var(--pencil);
  cursor: default;
}

:slotted(.cta):disabled > span {
  text-decoration: none;
}

:slotted(.cta-arrow) {
  flex: 0 0 auto;
}

/* A small status card: card stock with a token-colored border. */
:slotted(.status) {
  margin: 0;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-top: 3px solid var(--color-accent);
  border-radius: 0 0 var(--radius-card) var(--radius-card);
  padding: 0.4rem 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink);
}

:slotted(.status.is-alert) {
  border-top-color: var(--tab-focus);
  color: var(--ink-marker-text);
}

:slotted(.status.is-done) {
  border-top-color: var(--tab-mastered);
}

:slotted(.line) {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: 1.75rem;
  color: var(--pencil);
}

:slotted(.link) {
  font-weight: 700;
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
}

:slotted(.link):hover {
  color: var(--color-accent-hover);
}

:slotted(.link):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

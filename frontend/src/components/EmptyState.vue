<script setup>
defineProps({
  /**
   * Retained for call-site compatibility and deliberately not rendered: the
   * world bans eyebrow labels (DESIGN.md, "Don't add eyebrow or kicker
   * labels"). The heading carries its own weight.
   */
  eyebrow: { type: String, default: '' },
  headline: { type: String, default: '' },
  subtext: { type: String, default: '' },
  tone: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'celebrate', 'pause'].includes(v),
  },
})
</script>

<template>
  <div class="empty-state" :data-tone="tone">
    <div class="empty-rules" aria-hidden="true">
      <span class="empty-rule" />
      <span class="empty-rule" />
      <span class="empty-rule" />
    </div>
    <h3 v-if="$slots.headline || headline" class="empty-headline">
      <slot name="headline">{{ headline }}</slot>
    </h3>
    <p v-if="$slots.subtext || subtext" class="empty-subtext">
      <slot name="subtext">{{ subtext }}</slot>
    </p>
    <div v-if="$slots.cta" class="empty-cta">
      <slot name="cta" />
    </div>
  </div>
</template>

<style scoped>
/* An empty sheet: three feint rules, a line in graphite, a pencil note under
   it and the way out written in blue. No illustration, no tile, no eyebrow. */
.empty-state {
  display: flex;
  flex-direction: column;
  padding: var(--line-pitch) 0;
  text-align: left;
}

.empty-rules {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--line-pitch);
}

.empty-rule {
  display: block;
  height: calc(var(--line-pitch) - 1px);
  border-bottom: 1px solid var(--rule);
  max-width: 22rem;
}

.empty-headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.empty-subtext {
  margin: 0;
  max-width: 42rem;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.empty-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.25rem;
  line-height: var(--line-pitch);
}

/* The way out is a line of blue text, whatever the call site passes in. */
.empty-cta :deep(a),
.empty-cta :deep(button) {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.empty-cta :deep(a:hover),
.empty-cta :deep(button:hover) {
  color: var(--color-accent-hover);
}

.empty-cta :deep(.pi) {
  display: none;
}
</style>

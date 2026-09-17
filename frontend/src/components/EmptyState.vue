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
  // Content-only: strips the card background, border, radius and drop
  // shadow. For call sites that already sit on their own card (e.g. inside
  // a `.sec` panel) so the empty state doesn't nest a third edge.
  flat: { type: Boolean, default: false },
})
</script>

<template>
  <div class="empty-state" :class="{ 'empty-state--flat': flat }" :data-tone="tone">
    <h2 v-if="$slots.headline || headline" class="empty-headline">
      <slot name="headline">{{ headline }}</slot>
    </h2>
    <p v-if="$slots.subtext || subtext" class="empty-subtext">
      <slot name="subtext">{{ subtext }}</slot>
    </p>
    <div v-if="$slots.cta" class="empty-cta">
      <slot name="cta" />
    </div>
  </div>
</template>

<style scoped>
/* An empty sheet is a single centred card on the desk: a line in graphite, a
   pencil note under it and the way out written in blue. No illustration, no
   tile, no eyebrow. */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 28rem;
  margin: 0 auto;
  padding: 2rem 1.75rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  text-align: center;
}

/* Content-only variant: no card, no border, no radius, no drop shadow --
   just the headline, line and link, for call sites that already sit on
   their own card. */
.empty-state--flat {
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
}

.empty-headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.empty-subtext {
  margin: 0.5rem 0 0;
  max-width: 42rem;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.empty-cta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 1.25rem;
  margin-top: 1rem;
  line-height: var(--lh-body);
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
  line-height: var(--lh-body);
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

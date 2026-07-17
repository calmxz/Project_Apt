<script setup>
defineProps({
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
    <div class="empty-illustration">
      <slot name="illustration">
        <svg
          viewBox="0 0 64 64"
          width="64"
          height="64"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M32 4 L34.4 27 L58 32 L34.4 37 L32 60 L29.6 37 L6 32 L29.6 27 Z"
            fill="currentColor"
          />
          <path
            d="M50 8 L51.2 14 L57 16 L51.2 18 L50 24 L48.8 18 L43 16 L48.8 14 Z"
            fill="currentColor"
            opacity="0.55"
          />
        </svg>
      </slot>
    </div>
    <p v-if="$slots.eyebrow || eyebrow" class="empty-eyebrow">
      <slot name="eyebrow">{{ eyebrow }}</slot>
    </p>
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
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: clamp(2.5rem, 6vw, 4rem) 1.5rem;
  gap: 0.75rem;
}

.empty-illustration {
  color: var(--color-accent-text);
  margin-bottom: 0.25rem;
  display: inline-flex;
  filter: drop-shadow(0 2px 8px rgba(255, 107, 92, 0.25));
}

.empty-state[data-tone='celebrate'] .empty-illustration {
  animation: empty-bounce 1.4s var(--motion-bounce) infinite;
}

.empty-state[data-tone='pause'] .empty-illustration {
  opacity: 0.7;
  filter: none;
  color: var(--color-text-muted);
}

@keyframes empty-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.empty-eyebrow {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0;
}

.empty-headline {
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 600;
  color: var(--color-heading);
  margin: 0;
  letter-spacing: var(--tracking-tight);
  line-height: var(--lh-display);
}

.empty-subtext {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  color: var(--color-text-muted);
  max-width: 32rem;
  margin: 0;
  line-height: var(--lh-body);
}

.empty-cta {
  margin-top: 0.75rem;
  display: inline-flex;
  gap: 0.5rem;
}
</style>

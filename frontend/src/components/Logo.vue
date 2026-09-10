<script setup>
defineOptions({ name: 'AppLogo' })

defineProps({
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v),
  },
  variant: {
    type: String,
    default: 'full',
    validator: (v) => ['mark-only', 'full'].includes(v),
  },
})
</script>

<template>
  <span class="logo" :data-size="size" :data-variant="variant">
    <svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="2.5"
        y="1.5"
        width="19"
        height="21"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <g stroke="var(--color-border-strong)" stroke-width="1">
        <line x1="11" y1="7.5" x2="18.5" y2="7.5" vector-effect="non-scaling-stroke" />
        <line x1="11" y1="12" x2="18.5" y2="12" vector-effect="non-scaling-stroke" />
        <line x1="11" y1="16.5" x2="18.5" y2="16.5" vector-effect="non-scaling-stroke" />
      </g>
      <line
        x1="8"
        y1="1.5"
        x2="8"
        y2="22.5"
        stroke="var(--margin-rule)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <span v-if="variant === 'full'" class="logo-name">Crux</span>
  </span>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--color-wordmark, var(--color-heading));
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  line-height: 1;
}

.logo[data-size='sm'] {
  font-size: 1rem;
  gap: 0.5rem;
}
.logo[data-size='md'] {
  font-size: 1.1875rem;
}
.logo[data-size='lg'] {
  font-size: 2rem;
  gap: 0.875rem;
}

.logo-mark {
  flex-shrink: 0;
  color: currentColor;
}

.logo[data-size='sm'] .logo-mark {
  width: 22px;
  height: 22px;
}
.logo[data-size='md'] .logo-mark {
  width: 28px;
  height: 28px;
}
.logo[data-size='lg'] .logo-mark {
  width: 56px;
  height: 56px;
}
</style>

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
    <svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M3.5 9.5 V5.5 a2 2 0 0 1 2-2 H12.5 a2 2 0 0 1 2 2 V9.5" fill="var(--tab-focus)" />
      <rect
        x="3.5"
        y="9.5"
        width="25"
        height="19"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      />
      <path
        d="M9 16 h14 M9 21.5 h8"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
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

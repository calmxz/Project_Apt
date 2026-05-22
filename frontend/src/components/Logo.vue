<script setup>
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
    <svg
      class="logo-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 0.5 L13.6 10.4 L23.5 12 L13.6 13.6 L12 23.5 L10.4 13.6 L0.5 12 L10.4 10.4 Z"
        fill="currentColor"
      />
      <path
        d="M19 2.5 L19.7 5.3 L22.5 6 L19.7 6.7 L19 9.5 L18.3 6.7 L15.5 6 L18.3 5.3 Z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
    <span v-if="variant === 'full'" class="logo-name">AdaptLearn</span>
  </span>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--color-wordmark, var(--color-heading));
  font-family: var(--font-display);
  font-weight: 700;
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
  color: var(--color-accent);
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

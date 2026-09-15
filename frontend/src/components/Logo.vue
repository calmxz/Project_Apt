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
      <path
        d="M26.6 10.9 A8 8 0 1 0 26.6 21.1"
        fill="none"
        stroke="currentColor"
        stroke-width="6.5"
        stroke-linecap="butt"
      />
      <line x1="5.5" y1="2" x2="5.5" y2="30" stroke="var(--margin-rule)" stroke-width="3" />
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

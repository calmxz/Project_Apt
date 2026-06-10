<script setup>
defineProps({
  count: { type: Number, default: 4 },
})
</script>

<template>
  <div class="msg-skel" aria-hidden="true" data-testid="session-messages-skeleton">
    <div
      v-for="i in count"
      :key="i"
      class="msg-skel-row"
      :class="i % 2 === 0 ? 'msg-skel-row--user' : 'msg-skel-row--assistant'"
    >
      <span class="msg-skel-bubble">
        <span class="msg-skel-line" />
        <span class="msg-skel-line msg-skel-line--short" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.msg-skel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem 0.25rem;
}

.msg-skel-row {
  display: flex;
}

.msg-skel-row--user {
  justify-content: flex-end;
}

.msg-skel-bubble {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 70%;
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-lg);
  background: var(--color-surface-soft);
}

.msg-skel-row--user .msg-skel-bubble {
  background: var(--color-surface);
}

.msg-skel-line {
  display: block;
  height: 0.6rem;
  width: 16rem;
  max-width: 60vw;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
  animation: msg-skel-pulse 1.4s ease-in-out infinite;
}

.msg-skel-line--short {
  width: 9rem;
}

@keyframes msg-skel-pulse {
  0% { opacity: 0.65; }
  50% { opacity: 0.35; }
  100% { opacity: 0.65; }
}

@media (prefers-reduced-motion: reduce) {
  .msg-skel-line { animation: none; }
}
</style>

<script setup>
defineProps({
  count: { type: Number, default: 4 },
})
</script>

<template>
  <!--
    Mirrors the real MessageList geometry (UserBubble / AssistantBubble) so the
    swap to live content is shift-free: both rows span the full column at a
    fixed width (content block = column minus the 2.6rem avatar gutter).
    Assistant rows carry the avatar + role tag + a raised content block (left);
    user rows are right-aligned with no avatar. aria-hidden: purely decorative
    loading state.
  -->
  <div class="msg-skel" aria-hidden="true" data-testid="session-messages-skeleton">
    <div
      v-for="i in count"
      :key="i"
      class="msg-skel-row"
      :class="i % 2 === 0 ? 'msg-skel-row--user' : 'msg-skel-row--assistant'"
    >
      <span v-if="i % 2 !== 0" class="msg-skel-avatar" />
      <span class="msg-skel-body">
        <span class="msg-skel-tag" />
        <span class="msg-skel-bubble">
          <span class="msg-skel-line" />
          <span
            v-if="i % 2 !== 0"
            class="msg-skel-line"
          />
          <span class="msg-skel-line msg-skel-line--short" />
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Geometry mirrors MessageList.vue (.msg-list gap) + Assistant/UserBubble. */
.msg-skel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 0.5rem 0.25rem;
}

.msg-skel-row {
  display: flex;
  gap: 0.625rem;
  align-items: flex-start;
}

.msg-skel-row--assistant {
  align-self: stretch;
  width: 100%;
  max-width: 100%;
}

.msg-skel-row--user {
  flex-direction: row-reverse;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
}

.msg-skel-avatar {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  margin-top: 0.125rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
}

.msg-skel-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  flex: 1 1 auto;
  max-width: calc(100% - 2.6rem);
}

.msg-skel-row--user .msg-skel-body {
  align-items: flex-end;
}

/* Role-tag placeholder ("tutor" / "you"). */
.msg-skel-tag {
  display: block;
  width: 2.25rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
  opacity: 0.55;
}

/* Content block — matches the bubble padding/radius of each role. */
.msg-skel-bubble {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: 100%;
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
  background: var(--color-surface-raised);
}

.msg-skel-row--user .msg-skel-bubble {
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  background: var(--color-surface-soft);
}

.msg-skel-line {
  display: block;
  height: 0.6rem;
  width: 18rem;
  max-width: 52vw;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
  animation: msg-skel-pulse 1.4s ease-in-out infinite;
}

.msg-skel-line--short {
  width: 9rem;
}

.msg-skel-row--user .msg-skel-line {
  width: 11rem;
}

.msg-skel-row--user .msg-skel-line--short {
  width: 6rem;
}

@keyframes msg-skel-pulse {
  0% { opacity: 0.65; }
  50% { opacity: 0.3; }
  100% { opacity: 0.65; }
}

@media (prefers-reduced-motion: reduce) {
  .msg-skel-line { animation: none; }
}
</style>

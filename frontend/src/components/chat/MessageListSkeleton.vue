<script setup>
defineProps({
  count: { type: Number, default: 4 },
})
</script>

<template>
  <!--
    Mirrors the real MessageList geometry (gutter + text column on the 28px
    pitch) so the swap to live content is shift-free. aria-hidden: purely
    decorative loading state.
  -->
  <div class="msg-skel" aria-hidden="true" data-testid="session-messages-skeleton">
    <div
      v-for="i in count"
      :key="i"
      class="msg-skel-row"
      :class="i % 2 === 0 ? 'msg-skel-row--user' : 'msg-skel-row--assistant'"
    >
      <span class="msg-skel-tag" />
      <span class="msg-skel-body">
        <span class="msg-skel-line" />
        <span v-if="i % 2 !== 0" class="msg-skel-line" />
        <span class="msg-skel-line msg-skel-line--short" />
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Card-shaped grey blocks; no shimmer, no gradients. */
.msg-skel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.msg-skel-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 78%;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  padding: 0.55rem 0.9rem 0.7rem;
}

.msg-skel-row--user {
  align-self: flex-end;
  background: var(--card-learner);
  border-color: var(--card-learner-edge);
}

.msg-skel-tag {
  display: block;
  width: 2.25rem;
  height: 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--card-edge);
}

.msg-skel-row--user .msg-skel-tag {
  background: var(--card-learner-edge);
}

.msg-skel-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.msg-skel-line {
  display: block;
  height: 0.6rem;
  width: 20rem;
  max-width: 100%;
  border-radius: var(--radius-sm);
  background: var(--card-edge);
}

.msg-skel-line--short {
  width: 10rem;
}

.msg-skel-row--user .msg-skel-line {
  width: 14rem;
  background: var(--card-learner-edge);
}

.msg-skel-row--user .msg-skel-line--short {
  width: 8rem;
}

@media (max-width: 599px) {
  .msg-skel-row {
    max-width: 92%;
  }
}
</style>

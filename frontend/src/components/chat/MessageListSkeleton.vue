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
/* Pencil-gray bars on the rules; no shimmer, no gradients. */
.msg-skel {
  display: block;
}

.msg-skel-row {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: 0 0.75rem;
  padding: var(--line-pitch) 0 0;
}

.msg-skel-tag {
  display: block;
  width: 2.25rem;
  height: 1px;
  margin-top: calc(var(--line-pitch) / 2);
  background: var(--rule-strong);
}

.msg-skel-body {
  display: block;
  min-width: 0;
}

.msg-skel-line {
  display: block;
  height: 1px;
  width: 36rem;
  max-width: 100%;
  margin-top: calc(var(--line-pitch) - 1px);
  background: var(--rule-strong);
}

.msg-skel-line--short {
  width: 18rem;
}

.msg-skel-row--user .msg-skel-line {
  width: 22rem;
}

.msg-skel-row--user .msg-skel-line--short {
  width: 12rem;
}

@media (max-width: 599px) {
  .msg-skel-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>

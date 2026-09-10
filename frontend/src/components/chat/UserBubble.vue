<script setup>
import MarkdownContent from './MarkdownContent.vue'

defineProps({
  content: { type: String, default: '' },
})
</script>

<template>
  <article class="msg user" data-testid="msg-user">
    <div class="msg-gutter">
      <span class="role-tag">you</span>
    </div>
    <div class="msg-body">
      <MarkdownContent class="content" :text="content || ''" />
    </div>
  </article>
</template>

<style scoped>
/* No bubble: the learner writes in blue on the same rules, with a small blue
   "you" in the gutter. */
.msg {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: 0 0.75rem;
  max-width: 100%;
  padding: var(--line-pitch) 0 0;
}

.msg-gutter {
  min-width: 0;
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 400;
  line-height: var(--line-pitch);
  color: var(--ink-learner);
}

.msg-body {
  min-width: 0;
}

.content {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-learner);
}

@media (max-width: 599px) {
  .msg {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>

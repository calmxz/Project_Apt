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
/* No bubble: the learner writes on the right-hand side of the same rules,
   with a small blue "you" in a right gutter. The tutor's gutter is on the
   left. */
.msg {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5rem;
  grid-template-areas: 'body gutter';
  gap: 0 0.75rem;
  max-width: 100%;
  padding: var(--line-pitch) 0 0;
  justify-items: end;
}

/* Flex column, not a block: an inline 13px role tag inside a 17px block shares
   the block's strut, and the two half-leadings make the line box 28.5px, so
   every turn drifted half a pixel off the rules. A flex item is blockified and
   carries only its own strut, so the gutter is exactly one pitch. */
.msg-gutter {
  grid-area: gutter;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink-learner);
}

.msg-body {
  grid-area: body;
  min-width: 0;
  max-width: 80%;
  justify-self: end;
  text-align: left;
  background: var(--color-surface-soft);
  /* A hairline panel, not a bubble: square, and 13px + the 1px rule is half a
     pitch of frame at each end, so the learner's block stays a whole multiple
     of the pitch. */
  border: 1px solid var(--rule-strong);
  border-radius: 0;
  padding: calc(var(--line-pitch) / 2 - 1px) 1rem;
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
    grid-template-areas: 'gutter' 'body';
    gap: 0;
  }

  .msg-body {
    max-width: 100%;
  }

  .msg-gutter {
    align-items: flex-end;
  }
}
</style>

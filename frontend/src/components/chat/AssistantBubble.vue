<script setup>
import { computed } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
import ToolCallChip from './ToolCallChip.vue'
import CitationsList from './CitationsList.vue'
import CheckRecap from './CheckRecap.vue'

const props = defineProps({
  message: { type: Object, required: true },
  streaming: { type: Boolean, default: false },
  // Cue-lands: this turn changed the profile, so its gutter carries the tick.
  landed: { type: Boolean, default: false },
})

// A failed tool call that was retried successfully in the same message is
// noise to the learner -- show only the successful chip.
const visibleToolCalls = computed(() => {
  const calls = props.message.tool_calls || []
  const succeeded = new Set(
    calls.filter((tc) => (tc.state || 'done') !== 'error').map((tc) => tc.name),
  )
  return calls.filter((tc) => tc.state !== 'error' || !succeeded.has(tc.name))
})
</script>

<template>
  <article
    :class="['msg', 'assistant', { streaming }]"
    :data-testid="streaming ? 'msg-streaming' : 'msg-assistant'"
  >
    <div class="msg-gutter">
      <span class="role-tag">tutor</span>
      <svg
        v-if="landed"
        class="landed-tick"
        viewBox="0 0 12 12"
        width="12"
        height="12"
        aria-hidden="true"
        focusable="false"
        data-testid="msg-landed-tick"
      >
        <path d="M2 6.5 L4.8 9.2 L10 3.2" pathLength="1" />
      </svg>
    </div>
    <div class="msg-body">
      <template v-if="message.check_batch">
        <CheckRecap :batch="message.check_batch" />
        <MarkdownContent
          v-if="message.content"
          class="content"
          :text="message.content"
          :streaming="streaming"
        />
      </template>
      <template v-else>
        <span v-for="(tc, ti) in visibleToolCalls" :key="tc.id ?? ti" class="tool-call-row">
          <ToolCallChip :tool_call="tc" :state="tc.state || 'done'" />
        </span>
        <MarkdownContent
          v-if="message.content || streaming"
          class="content"
          :text="message.content || ''"
          :streaming="streaming"
        />
      </template>
      <span v-if="message.status === 'cancelled'" class="cancelled-marker">(stopped)</span>
      <span v-else-if="message.status === 'partial'" class="cancelled-marker">(interrupted)</span>
      <CitationsList :citations="message.citations || []" />
    </div>
  </article>
</template>

<style scoped>
/* No bubble and no avatar: the tutor writes on the rules, its name sits in
   the gutter in pencil. */
.msg {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: 0 0.75rem;
  max-width: 100%;
  padding: var(--line-pitch) 0 0;
}

.msg-gutter {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 400;
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.landed-tick {
  fill: none;
  stroke: var(--ink-learner);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
  animation: tick-draw var(--motion-base) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes tick-draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.msg-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.content {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.tool-call-row {
  display: block;
}

.cancelled-marker {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-style: italic;
  line-height: var(--line-pitch);
  color: var(--pencil);
}

@media (prefers-reduced-motion: reduce) {
  .landed-tick {
    animation: none;
  }
}

@media (max-width: 599px) {
  .msg {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .msg-gutter {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
}
</style>

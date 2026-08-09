<script setup>
import { computed } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
import ToolCallChip from './ToolCallChip.vue'
import CitationsList from './CitationsList.vue'
import CheckRecap from './CheckRecap.vue'

const props = defineProps({
  message: { type: Object, required: true },
  streaming: { type: Boolean, default: false },
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
    <span class="msg-avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
        <path
          d="M12 0.5 L13.6 10.4 L23.5 12 L13.6 13.6 L12 23.5 L10.4 13.6 L0.5 12 L10.4 10.4 Z"
          fill="currentColor"
        />
      </svg>
    </span>
    <div class="msg-body">
      <span class="role-tag">tutor</span>
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
.msg {
  display: flex;
  gap: 0.625rem;
  max-width: 100%;
  align-items: flex-start;
}

.msg-avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  margin-top: 0.125rem;
}

.msg-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  flex: 1 1 auto;
  max-width: calc(100% - 2.6rem);
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-faint);
}

.content {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--color-text);
}

.msg.assistant {
  align-self: stretch;
  width: 100%;
  max-width: 100%;
}

.msg.assistant .content {
  background: var(--color-surface-raised);
  border: none;
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
  box-shadow: none;
}

.tool-call-row {
  display: inline-flex;
  margin: 0 0 0.4rem;
}

.cancelled-marker {
  font-size: 0.8125rem;
  font-style: italic;
  color: var(--color-text-muted, #888);
  margin-top: 0.125rem;
}
</style>

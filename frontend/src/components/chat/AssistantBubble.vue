<script setup>
import MarkdownContent from './MarkdownContent.vue'
import ToolCallChip from './ToolCallChip.vue'
import CitationsList from './CitationsList.vue'

defineProps({
  message: { type: Object, required: true },
  streaming: { type: Boolean, default: false },
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
      <span
        v-for="(tc, ti) in (message.tool_calls || [])"
        :key="tc.id ?? ti"
        class="tool-call-row"
      >
        <ToolCallChip :tool_call="tc" :state="tc.state || 'done'" />
      </span>
      <MarkdownContent class="content" :text="message.content || ''" :streaming="streaming" />
      <span v-if="message.status === 'cancelled'" class="cancelled-marker">(stopped)</span>
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
  align-self: flex-start;
  max-width: 95%;
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

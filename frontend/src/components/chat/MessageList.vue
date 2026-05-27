<script setup>
import UserBubble from './UserBubble.vue'
import AssistantBubble from './AssistantBubble.vue'

defineProps({
  messages: { type: Array, required: true },
  streamingMessage: { type: Object, default: null },
  awaiting: { type: Boolean, default: false },
})
</script>

<template>
  <div class="message-list">
    <TransitionGroup name="msg-fade" tag="div" class="msg-list">
      <template v-for="(m, i) in messages" :key="m.message_id || `m-${i}`">
        <UserBubble v-if="m.role === 'user'" :content="m.content || ''" />
        <AssistantBubble v-else :message="m" :streaming="false" />
      </template>
    </TransitionGroup>
    <article
      v-if="awaiting && !streamingMessage"
      class="msg assistant typing"
      data-testid="msg-typing"
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
        <p class="content typing-dots" aria-label="Tutor is thinking">
          <span></span><span></span><span></span>
        </p>
      </div>
    </article>
    <AssistantBubble
      v-if="streamingMessage"
      :message="streamingMessage"
      :streaming="true"
    />
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.msg-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.msg-fade-enter-active,
.msg-fade-leave-active {
  transition: opacity var(--motion-base) ease, transform var(--motion-base) var(--motion-bounce);
}

.msg-fade-enter-from { opacity: 0; transform: translateY(8px); }
.msg-fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* Typing indicator article (bespoke markup) */
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
  color: var(--color-accent);
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

.msg.assistant {
  align-self: flex-start;
  max-width: 95%;
}

.msg.typing .content {
  display: inline-flex;
  gap: 0.3rem;
  padding: 0.875rem 1.125rem;
  align-items: center;
}

.typing-dots span {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: typing-bob 1200ms ease-in-out infinite;
}

.typing-dots span:nth-child(2) { animation-delay: 200ms; }
.typing-dots span:nth-child(3) { animation-delay: 400ms; }

@keyframes typing-bob {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-5px); opacity: 1; }
}
</style>

<script setup>
import { computed } from 'vue'

import UserBubble from './UserBubble.vue'
import AssistantBubble from './AssistantBubble.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  streamingMessage: { type: Object, default: null },
  awaiting: { type: Boolean, default: false },
  // Cue-lands: the latest tutor turn changed the profile, so its gutter
  // carries the blue tick until the learner writes again.
  landed: { type: Boolean, default: false },
})

// U-01: history can contain assistant rows with nothing to show (e.g. a
// turn whose only output was tool activity that persisted no text).
// AssistantBubble would render them as an empty row, so they are
// skipped. Cancelled/partial rows keep their marker even without text.
function _renderable(m) {
  if (m.role === 'user') return true
  return Boolean(
    m.content ||
    m.check_batch ||
    m.tool_calls?.length ||
    m.citations?.length ||
    m.status === 'cancelled' ||
    m.status === 'partial',
  )
}

const visibleMessages = computed(() => props.messages.filter(_renderable))

// Index of the last rendered assistant row; the tick belongs to that turn.
const lastAssistantIndex = computed(() => {
  for (let i = visibleMessages.value.length - 1; i >= 0; i -= 1) {
    if (visibleMessages.value[i].role !== 'user') return i
  }
  return -1
})

function tickAt(i) {
  return props.landed && !props.streamingMessage && i === lastAssistantIndex.value
}
</script>

<template>
  <div class="message-list">
    <TransitionGroup name="msg-fade" tag="div" class="msg-list">
      <template v-for="(m, i) in visibleMessages" :key="m.message_id || `m-${i}`">
        <UserBubble v-if="m.role === 'user'" :content="m.content || ''" />
        <AssistantBubble v-else :message="m" :streaming="false" :landed="tickAt(i)" />
      </template>
    </TransitionGroup>
    <article
      v-if="awaiting && !streamingMessage"
      class="msg assistant typing"
      data-testid="msg-typing"
    >
      <div class="msg-gutter">
        <span class="role-tag">tutor</span>
      </div>
      <div class="msg-body">
        <p class="content typing-dots" aria-label="Tutor is thinking">
          <span></span><span></span><span></span>
        </p>
      </div>
    </article>
    <AssistantBubble v-if="streamingMessage" :message="streamingMessage" :streaming="true" />
  </div>
</template>

<style scoped>
.message-list,
.msg-list {
  display: block;
}

/* Ink appears; it never slides. */
.msg-fade-enter-active {
  transition: opacity var(--motion-base) ease;
}

.msg-fade-enter-from {
  opacity: 0;
}

.msg-fade-leave-active {
  transition: opacity var(--motion-fast) ease;
}

.msg-fade-leave-to {
  opacity: 0;
}

/* Turns apart: a change of voice is worth two pitches, consecutive turns in
   the same voice keep one. A parent's scoped rule reaches the root element of
   a child component, which is exactly the turn block being spaced here. */
.msg.user + .msg.assistant,
.msg.assistant + .msg.user {
  padding-top: calc(var(--line-pitch) * 2);
}

/* The typing row and the streaming turn are siblings of the list, not children
   of it, so their adjacent neighbour is the list itself: they take the wider
   gap only when the last thing written was the learner. */
.msg-list:has(> .msg.user:last-child) + .msg.typing,
.msg-list:has(> .msg.user:last-child) + .msg.assistant {
  padding-top: calc(var(--line-pitch) * 2);
}

/* Typing indicator row (bespoke markup, same gutter grammar as a turn).
   Scoped to .typing: a bare .msg rule here also lands on the root of every
   child bubble (a parent's scoped rule reaches a child's root element) and
   would override the learner turn's mirrored grid. */
.msg.typing {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: 0 0.75rem;
  max-width: 100%;
  padding: var(--line-pitch) 0 0;
}

/* Same reason as the turn gutters: an inline role tag in a block would share
   the 17px strut and make the row 28.5px. */
.msg.typing .msg-gutter {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

/* Block-level, not inline-flex: inline would sit on the body's baseline and
   add half-leading on top of its own 28px. */
.msg.typing .content {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  height: var(--line-pitch);
}

.typing-dots span {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--pencil);
  animation: typing-fade 1200ms ease-in-out infinite;
}

.typing-dots span:nth-child(2) {
  animation-delay: 200ms;
}
.typing-dots span:nth-child(3) {
  animation-delay: 400ms;
}

@keyframes typing-fade {
  0%,
  60%,
  100% {
    opacity: 0.35;
  }
  30% {
    opacity: 1;
  }
}

/* The dots stop pulsing and settle between the two ends of the pulse, so the
   row still reads as pencil-weight waiting ink rather than a frozen frame. */
@media (prefers-reduced-motion: reduce) {
  .typing-dots span {
    animation: none;
    opacity: 0.6;
  }

  .msg-fade-enter-active,
  .msg-fade-leave-active {
    transition: none;
  }
}

@media (max-width: 599px) {
  .msg.typing {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>

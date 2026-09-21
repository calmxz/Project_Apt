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
      <!-- F-21: an optimistic user row has no server id until the turn is
           reloaded, so two of them in a row both fell back to the index and
           shared a key. client_id is the local stand-in; message_id still
           wins wherever it exists (it is also the pagination cursor, so a
           client value must never be written into it). -->
      <template v-for="(m, i) in visibleMessages" :key="m.message_id ?? m.client_id ?? `m-${i}`">
        <UserBubble
          v-if="m.role === 'user'"
          :content="m.content || ''"
          :created-at="m.created_at || null"
        />
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
        <!-- D-07: aria-label on a <p> is not a supported name source. The dots
             are decoration; the text lives in a visually-hidden sibling so
             `.typing-dots span` cannot style it as a fourth dot. -->
        <span class="sr-only">Tutor is thinking</span>
        <p class="content typing-dots"><span></span><span></span><span></span></p>
      </div>
    </article>
    <AssistantBubble v-if="streamingMessage" :message="streamingMessage" :streaming="true" />
  </div>
</template>

<style scoped>
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* A card appears; it never slides. */
.msg-fade-enter-active {
  transition: opacity var(--motion-fast) ease;
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

/* The typing row and the streaming turn are siblings of the list, not
   children of it: give them the same card gap as everything else. */
.msg-list + .msg.typing,
.msg-list + .msg.assistant {
  margin-top: 0.75rem;
}

/* Typing indicator: a tutor card with three dots instead of prose. Scoped to
   .typing so it never collides with the learner card's own rule. */
.msg.typing {
  align-self: flex-start;
  max-width: 78%;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  padding: 0.55rem 0.9rem 0.7rem;
}

.msg.typing .msg-gutter {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 700;
  color: var(--pencil);
}

.msg.typing .content {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
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
    max-width: 92%;
  }
}
</style>

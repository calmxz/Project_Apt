<script setup>
import MarkdownContent from './MarkdownContent.vue'

defineProps({
  content: { type: String, default: '' },
})
</script>

<template>
  <article class="msg user" data-testid="msg-user">
    <div class="msg-body">
      <span class="role-tag">you</span>
      <MarkdownContent class="content" :text="content || ''" />
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

.msg.user {
  flex-direction: row-reverse;
  align-self: flex-end;
  max-width: 88%;
}

.msg.user .msg-body {
  align-items: flex-end;
  text-align: left;
  max-width: 100%;
}

.msg.user .role-tag {
  color: var(--color-accent);
}

.msg.user .content {
  display: inline-block;
  background: var(--color-accent);
  color: #FFFFFF;
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  text-align: left;
  box-shadow: 0 2px 8px -4px rgba(255, 107, 92, 0.22);
}
</style>

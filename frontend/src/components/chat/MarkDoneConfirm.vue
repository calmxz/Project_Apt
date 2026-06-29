<script setup>
defineProps({ lessonTitle: { type: String, required: true } })
defineEmits(['confirm', 'dismiss'])
</script>
<template>
  <div class="markdone" data-testid="session-markdone" role="status">
    <p class="markdone-text">Looks like you have got this — mark <strong>{{ lessonTitle }}</strong> done?</p>
    <div class="markdone-actions">
      <button type="button" class="markdone-yes" data-testid="session-markdone-yes" @click="$emit('confirm')">Yes</button>
      <button type="button" class="markdone-keep" data-testid="session-markdone-keep" @click="$emit('dismiss')">Keep going</button>
    </div>
  </div>
</template>
<style scoped>
.markdone { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem; background: var(--color-accent-soft); border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg); }
.markdone-text { margin: 0; color: var(--color-text); font-size: 0.9375rem; }
.markdone-actions { display: inline-flex; gap: 0.5rem; }
.markdone-yes { padding: 0.4rem 1rem; border: 0; border-radius: var(--radius-pill);
  background: var(--color-accent-strong); color: #FFFFFF; font-weight: 600; cursor: pointer; box-shadow: var(--shadow-pop); }
.markdone-keep { padding: 0.4rem 1rem; border: 1px solid var(--color-border-strong); border-radius: var(--radius-pill);
  background: var(--color-surface); color: var(--color-text-muted); font-weight: 600; cursor: pointer; }
</style>

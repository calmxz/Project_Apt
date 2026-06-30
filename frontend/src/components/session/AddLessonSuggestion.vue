<template>
  <aside class="suggest" role="note" data-testid="add-lesson-suggestion">
    <p class="suggest-text">
      You're finding <strong>{{ suggestion.gap }}</strong> tricky — want me to add a
      short <strong>{{ suggestion.suggested_title }}</strong> lesson?
    </p>
    <div class="suggest-actions">
      <button type="button" class="btn-add" data-testid="suggest-add" @click="$emit('add', suggestion)">
        Add
      </button>
      <button type="button" class="btn-dismiss" data-testid="suggest-dismiss" @click="$emit('dismiss')">
        No thanks
      </button>
    </div>
  </aside>
</template>

<script setup>
defineProps({
  suggestion: { type: Object, required: true },
})
defineEmits(['add', 'dismiss'])
</script>

<style scoped>
.suggest {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem;
  padding: 0.875rem 1.125rem; margin: 0.5rem 0;
  border: 1px solid var(--color-accent-soft); border-radius: var(--radius-card);
  background: var(--color-surface-soft);
}
.suggest-text { margin: 0; flex: 1; color: var(--color-text); font-size: 0.9375rem; }
.suggest-actions { display: inline-flex; gap: 0.5rem; }
.btn-add {
  padding: 0.4rem 1rem; border: 0; border-radius: var(--radius-pill);
  background: var(--color-accent-strong); color: #fff; font-weight: 600; cursor: pointer;
}
.btn-dismiss {
  padding: 0.4rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-pill);
  background: transparent; color: var(--color-text-muted); cursor: pointer;
}
</style>

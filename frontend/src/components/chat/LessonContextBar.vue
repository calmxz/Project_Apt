<script setup>
defineProps({ goal: { type: String, default: '' }, subjectId: { type: String, default: '' } })
</script>
<template>
  <div v-if="goal" class="lesson-bar">
    <RouterLink v-if="subjectId" class="lesson-back" data-testid="session-lesson-back"
                :to="{ name: 'subject-overview', params: { id: subjectId } }">
      <i class="pi pi-arrow-left" aria-hidden="true" /> Subject
    </RouterLink>
    <p class="lesson-goal" data-testid="session-lesson-goal">{{ goal }}</p>
  </div>
</template>
<style scoped>
.lesson-bar { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem;
  background: var(--color-surface-soft); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.lesson-back { display: inline-flex; align-items: center; gap: 0.25rem; flex-shrink: 0;
  font-family: var(--font-sans); font-size: var(--fs-caption); font-weight: 600; color: var(--color-accent-text); }
.lesson-goal { margin: 0; color: var(--color-text-muted); font-size: var(--fs-caption); }
</style>

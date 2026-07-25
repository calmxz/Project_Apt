<script setup>
defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
defineEmits(['quiz', 'level', 'dismiss'])

const LEVELS = ['beginner', 'intermediate', 'advanced']
const LABELS = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
</script>

<template>
  <section
    class="diag-card"
    data-testid="diagnostic-consent-card"
    aria-label="Knowledge check offer"
  >
    <div class="diag-head">
      <p class="diag-title">Want me to pitch this at the right level?</p>
      <button
        type="button"
        class="diag-dismiss"
        data-testid="diag-dismiss"
        aria-label="Dismiss knowledge check offer"
        @click="$emit('dismiss')"
      >
        &times;
      </button>
    </div>
    <p class="diag-sub">Take a quick 3-question check, or tell me where you are.</p>
    <div class="diag-actions">
      <button
        type="button"
        class="diag-quiz"
        data-testid="diag-quiz"
        :disabled="busy"
        @click="$emit('quiz')"
      >
        Quiz me (3 quick questions)
      </button>
      <button
        v-for="lvl in LEVELS"
        :key="lvl"
        type="button"
        class="diag-level"
        :data-testid="`diag-level-${lvl}`"
        :disabled="busy"
        @click="$emit('level', lvl)"
      >
        {{ LABELS[lvl] }}
      </button>
    </div>
    <p v-if="error" class="diag-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.diag-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 0.5rem 0;
  background: var(--color-surface);
}
.diag-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.diag-title {
  margin: 0;
  font-weight: 600;
}
.diag-sub {
  margin: 0.25rem 0 0.5rem;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.diag-dismiss {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-muted);
}
.diag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.diag-error {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--color-error-text);
}
</style>

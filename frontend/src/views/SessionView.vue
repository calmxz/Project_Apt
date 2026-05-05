<template>
  <section>
    <h1>Session</h1>
    <p class="muted">Session id: {{ id }}. Chat surface lands here in Phase 2.</p>
  </section>
</template>

<script setup>
defineProps({ id: { type: String, required: true } })
</script>

<style scoped>
.muted { color: var(--color-text-muted, #888); }
</style>

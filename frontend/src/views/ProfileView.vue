<template>
  <section>
    <BackButton />
    <h1>Profile</h1>
    <p class="muted">Read-only profile dashboard for session {{ id }} lands here in Phase 5.</p>
  </section>
</template>

<script setup>
import BackButton from '../components/BackButton.vue'

defineProps({ id: { type: String, required: true } })
</script>

<style scoped>
.muted { color: var(--color-text-muted, #888); }
</style>

<template>
  <section>
    <BackButton />
    <h1>Settings</h1>
    <p class="muted">Preferences and retake-onboarding land here in Phase 9.</p>
  </section>
</template>

<script setup>
import BackButton from '../components/BackButton.vue'
</script>

<style scoped>
.muted { color: var(--color-text-muted, #888); }
</style>

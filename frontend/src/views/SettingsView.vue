<template>
  <section>
    <BackButton />
    <h1>Settings</h1>
    <p class="muted">Preferences and retake-onboarding will land in a later phase.</p>
    <p class="muted">
      Want to redo onboarding now?
      <router-link to="/onboarding?retake=1" data-testid="settings-retake-onboarding">
        Retake onboarding
      </router-link>
    </p>
  </section>
</template>

<script setup>
import BackButton from '../components/BackButton.vue'
</script>

<style scoped>
.muted { color: var(--color-text-muted, #888); }
</style>

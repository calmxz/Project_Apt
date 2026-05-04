<template>
  <section class="home">
    <h1>Sessions</h1>
    <p class="muted">No sessions yet.</p>
    <RouterLink to="/new" class="btn">Start a new topic</RouterLink>
  </section>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.home {
  max-width: 640px;
}
.muted {
  color: var(--color-text-muted, #888);
}
.btn {
  display: inline-block;
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  text-decoration: none;
  color: inherit;
}
</style>

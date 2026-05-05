<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="topnav">
    <RouterLink to="/" class="brand">AdaptLearn</RouterLink>
    <RouterLink to="/settings" class="settings" aria-label="Settings">
      <i class="pi pi-cog" />
    </RouterLink>
  </header>
  <main>
    <RouterView />
  </main>
</template>

<style scoped>
.topnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}
.brand {
  font-weight: 600;
  text-decoration: none;
  color: inherit;
}
.settings {
  text-decoration: none;
  color: inherit;
  font-size: 1.1rem;
}
main {
  padding: 1rem 1.25rem;
}
</style>

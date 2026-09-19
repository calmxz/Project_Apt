<script setup>
defineProps({ count: { type: Number, default: 6 } })
</script>

<template>
  <ul class="library-skel" aria-hidden="true" data-testid="library-skeleton">
    <li v-for="i in count" :key="i" class="skel-row">
      <span class="skel-line skel-topic" />
      <span class="skel-line skel-focus" />
    </li>
  </ul>
</template>

<style scoped>
/* Card-shaped grey blocks standing in for the session cards they precede.
   No shimmer: a still placeholder, not an animated one. */
.library-skel {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skel-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.skel-line {
  display: block;
  height: 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--desk-deep);
}

.skel-topic {
  width: 42%;
}

.skel-focus {
  width: 26%;
}
</style>

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
/* Pencil-weight bars on the rules, in the row geometry they stand in for.
   No shimmer, no card, no radius: a page waiting to be written on. */
.library-skel {
  list-style: none;
  margin: 0;
  padding: 0;
  background-image: var(--ruled-bg);
  background-position-y: var(--ruled-offset);
  background-attachment: local;
}

.skel-row {
  padding: 0 0.25rem 0 0.75rem;
}

.skel-line {
  display: block;
  height: 1px;
  background: var(--rule-strong);
}

.skel-topic {
  width: 42%;
  margin: calc(var(--line-pitch) / 2 - 1px) 0 calc(var(--line-pitch) / 2);
}

.skel-focus {
  width: 26%;
  margin: calc(var(--line-pitch) / 2 - 1px) 0 calc(var(--line-pitch) / 2);
}
</style>

<script setup>
defineProps({
  count: { type: Number, default: 3 },
})
</script>

<template>
  <ul class="sb-skel-list" aria-hidden="true">
    <li v-for="i in count" :key="i" class="sb-skel-row">
      <span class="sb-skel-line" :class="`sb-skel-line--${i % 3}`" />
    </li>
  </ul>
</template>

<style scoped>
/* Pencil bars written on the rules: the rows that are about to arrive, at the
   same pitch and in the same gutter as the real ones. */
.sb-skel-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sb-skel-row {
  display: flex;
  align-items: center;
  height: var(--line-pitch);
  padding: 0 0.75rem;
}

/* Card-shaped grey blocks: the rows that are about to arrive, at rest --
   no shimmer, no pulse. */
.sb-skel-line {
  height: 0.5rem;
  width: 70%;
  border-radius: var(--radius-card);
  background: var(--pencil);
  opacity: 0.19;
}

.sb-skel-line--0 {
  width: 55%;
}

.sb-skel-line--2 {
  width: 80%;
}
</style>

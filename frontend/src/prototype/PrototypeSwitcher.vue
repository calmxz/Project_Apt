<script setup>
// PROTOTYPE - throwaway floating variant switcher. Mounted from App.vue in
// dev builds only. Cycles ?variant= and mirrors it into sessionStorage so
// the choice survives in-app navigation that drops the query string.
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VARIANTS, fakeData, setVariant, variant } from './dueMarkerProto.js'

const route = useRoute()
const router = useRouter()

const idx = computed(() =>
  Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === variant.value),
  ),
)
const current = computed(() => VARIANTS[idx.value])

function go(delta) {
  const next = VARIANTS[(idx.value + delta + VARIANTS.length) % VARIANTS.length]
  setVariant(next.key)
  router?.replace?.({ query: { ...route?.query, variant: next.key } })
}

function onKey(e) {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'ArrowLeft') go(-1)
  if (e.key === 'ArrowRight') go(1)
}

watch(
  () => route?.query?.variant,
  (q) => {
    if (q && VARIANTS.some((v) => v.key === q) && q !== variant.value) setVariant(String(q))
  },
  { immediate: true },
)

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="proto-bar" role="group" aria-label="Prototype variant switcher">
    <button type="button" class="proto-bar-btn" aria-label="Previous variant" @click="go(-1)">
      &larr;
    </button>
    <span class="proto-bar-label">
      {{ current.key }} &mdash; {{ current.name }}
      <em v-if="fakeData">(fake due data)</em>
    </span>
    <button type="button" class="proto-bar-btn" aria-label="Next variant" @click="go(1)">
      &rarr;
    </button>
  </div>
</template>

<style scoped>
.proto-bar {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  background: #111;
  color: #fff;
  font:
    600 13px/1.2 system-ui,
    sans-serif;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.proto-bar em {
  font-weight: 400;
  opacity: 0.7;
  margin-left: 0.4rem;
}

.proto-bar-btn {
  border: 0;
  background: #333;
  color: #fff;
  border-radius: 999px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 15px;
}

.proto-bar-btn:hover {
  background: #555;
}
</style>

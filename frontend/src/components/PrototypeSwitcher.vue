<script setup>
// PROTOTYPE furniture: a floating bar that flips between UI variants on a
// route via the ?variant= search param. Dev-only; renders nothing in a
// production build so a stray merge cannot ship it.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const props = defineProps({
  // [{ key: 'A', name: 'Dividers' }, ...]
  variants: { type: Array, required: true },
  current: { type: String, required: true },
})

const route = useRoute()
const router = useRouter()
const isProd = import.meta.env.PROD

const index = computed(() => {
  const i = props.variants.findIndex((v) => v.key === props.current)
  return i < 0 ? 0 : i
})
const label = computed(() => {
  const v = props.variants[index.value]
  return v ? `${v.key} - ${v.name}` : props.current
})

function go(delta) {
  const n = props.variants.length
  const next = props.variants[(index.value + delta + n) % n]
  router.replace({ query: { ...route.query, variant: next.key } })
}

function onKey(e) {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return
  }
  if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="!isProd" class="proto-bar" role="group" aria-label="Prototype variant">
    <button type="button" class="proto-btn" aria-label="Previous variant" @click="go(-1)">
      &larr;
    </button>
    <span class="proto-label">{{ label }}</span>
    <button type="button" class="proto-btn" aria-label="Next variant" @click="go(1)">&rarr;</button>
  </div>
</template>

<style scoped>
/* Deliberately alien to the design world (high-contrast pill, soft shadow)
   so nobody mistakes it for part of the page under evaluation. */
.proto-bar {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  z-index: 1000;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  background: #111;
  color: #fff;
  font:
    600 0.8125rem/1.4 ui-monospace,
    monospace;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.proto-btn {
  border: 0;
  background: #333;
  color: #fff;
  border-radius: 999px;
  width: 1.75rem;
  height: 1.75rem;
  cursor: pointer;
  font: inherit;
}

.proto-btn:hover {
  background: #555;
}

.proto-label {
  white-space: nowrap;
}
</style>

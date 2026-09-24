<script setup>
// PROTOTYPE shared figure: the 12-week mastered column series, lifted from
// LearningTab.vue so every variant draws the same mark (green only Mastered).
import { computed } from 'vue'

const props = defineProps({
  points: { type: Array, required: true },
  height: { type: Number, default: 56 },
  barWidth: { type: Number, default: 16 },
  gap: { type: Number, default: 8 },
})

const hasData = computed(() => props.points.some((w) => w.count > 0))
const max = computed(() => Math.max(...props.points.map((w) => w.count), 1))
const width = computed(() => {
  const n = props.points.length
  return n ? n * props.barWidth + (n - 1) * props.gap : props.barWidth
})

function label(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const columns = computed(() => {
  const n = props.points.length
  return props.points.map((w, i) => {
    const h = (w.count / max.value) * props.height
    return {
      key: w.week_start,
      x: i * (props.barWidth + props.gap),
      y: props.height - h,
      h,
      label: label(w.week_start),
      show: i === 0 || i === n - 1 || (i % 4 === 0 && n - 1 - i >= 2),
      title: `Week of ${label(w.week_start)}: ${w.count} mastered`,
    }
  })
})
</script>

<template>
  <div v-if="hasData" class="wk">
    <svg
      class="wk-svg"
      :viewBox="`0 0 ${width} ${height + 1}`"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <line class="wk-base" :x1="0" :x2="width" :y1="height" :y2="height" />
      <rect
        v-for="c in columns"
        :key="c.key"
        class="wk-bar"
        :x="c.x"
        :y="c.y"
        :width="barWidth"
        :height="c.h"
        rx="4"
        ry="4"
      >
        <title>{{ c.title }}</title>
      </rect>
    </svg>
    <div class="wk-labels" aria-hidden="true">
      <span v-for="c in columns" :key="c.key" class="wk-label">{{ c.show ? c.label : '' }}</span>
    </div>
    <ul class="sr-only">
      <li v-for="c in columns" :key="c.key">{{ c.title }}</li>
    </ul>
  </div>
  <p v-else class="wk-none">none yet</p>
</template>

<style scoped>
.wk {
  max-width: 20rem;
  width: 100%;
}

.wk-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.wk-base {
  stroke: var(--rule);
  stroke-width: 1;
}

.wk-bar {
  fill: var(--tab-mastered);
}

.wk-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
}

.wk-label {
  flex: 1 1 0;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  text-align: center;
  white-space: nowrap;
}

.wk-none {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}
</style>

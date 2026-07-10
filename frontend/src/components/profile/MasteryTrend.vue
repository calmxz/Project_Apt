<template>
  <div class="trend" data-testid="mastery-trend">
    <h2 class="section-title">Mastery over time</h2>
    <p v-if="allZero" class="muted" data-testid="trend-empty">
      Nothing new mastered in the last 12 weeks yet — trends appear as you
      answer check questions correctly.
    </p>
    <div v-else class="trend-chart" role="img" :aria-label="ariaLabel">
      <div
        v-for="pt in weeklyMastery"
        :key="pt.week_start"
        class="trend-col"
        :title="`Week of ${pt.week_start}: ${pt.count}`"
      >
        <span class="trend-bar-track">
          <span class="trend-bar" :style="{ height: barHeight(pt) }" />
        </span>
        <span class="trend-tick">{{ pt.week_start.slice(5) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  weeklyMastery: { type: Array, required: true },
})

const maxCount = computed(() =>
  Math.max(...props.weeklyMastery.map((p) => p.count), 0),
)

const allZero = computed(() => maxCount.value === 0)

const total = computed(() =>
  props.weeklyMastery.reduce((acc, p) => acc + p.count, 0),
)

const ariaLabel = computed(
  () => `${total.value} concepts mastered over the last 12 weeks`,
)

const barHeight = (pt) =>
  `${maxCount.value ? Math.round((pt.count / maxCount.value) * 100) : 0}%`
</script>

<style scoped>
.trend {
  display: flex;
  flex-direction: column;
}

.section-title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0 0 0.875rem 0;
}

.muted { color: var(--color-text-muted); }

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.375rem;
  height: 7rem;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  height: 100%;
  min-width: 0;
}

.trend-bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  border-radius: var(--radius-sm);
  background: var(--color-surface-soft);
}

.trend-bar {
  display: block;
  width: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-coral-400);
  min-height: 0;
}

.trend-tick {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  color: var(--color-text-faint);
  white-space: nowrap;
}
</style>

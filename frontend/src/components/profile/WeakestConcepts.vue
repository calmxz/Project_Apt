<template>
  <div class="weakest" data-testid="weakest-concepts">
    <h2 class="section-title">
      <i class="pi pi-chart-line col-icon" aria-hidden="true" />
      Weakest concepts
    </h2>
    <p v-if="!ranked.length" class="muted" data-testid="weakest-empty">
      Answer more check questions to see trends — concepts appear after two
      attempts.
    </p>
    <ul v-else class="rank-list">
      <li v-for="item in ranked" :key="item.concept" class="rank-row">
        <router-link
          :to="{ name: 'session-profile', params: { id: item.first_seen_session_id } }"
          class="rank-link"
        >
          <span class="rank-name">{{ item.concept }}</span>
          <span
            class="rank-bar"
            role="img"
            :aria-label="`${pct(item)} percent accuracy over ${item.total_count} attempts`"
          >
            <span class="rank-fill" :style="{ width: pct(item) + '%' }" />
          </span>
          <span class="rank-pct">{{ pct(item) }}%</span>
          <span class="spark" aria-hidden="true">
            <span
              v-for="(r, i) in item.last_results"
              :key="i"
              :class="['spark-dot', r ? 'dot-correct' : 'dot-wrong']"
            />
          </span>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  conceptAccuracy: { type: Array, required: true },
})

const ranked = computed(() =>
  props.conceptAccuracy
    .filter((c) => c.total_count >= 2)
    .sort((a, b) => a.accuracy - b.accuracy || a.concept.localeCompare(b.concept))
    .slice(0, 5),
)

const pct = (c) => Math.round(c.accuracy * 100)
</script>

<style scoped>
.weakest {
  display: flex;
  flex-direction: column;
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0 0 0.875rem 0;
}

.col-icon {
  font-size: 1.05rem;
  color: var(--color-accent-text);
}

.muted { color: var(--color-text-muted); }

.rank-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rank-row {
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: border-color var(--motion-fast) ease;
}

.rank-row:hover { border-color: var(--color-accent-soft); }

.rank-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: inherit;
  text-decoration: none;
}

.rank-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--color-heading);
}

.rank-bar {
  flex: 0 0 6rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.rank-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent-coral-400);
}

.rank-pct {
  flex: 0 0 2.75rem;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.spark {
  display: inline-flex;
  gap: 0.2rem;
}

.spark-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
}

.dot-correct { background: var(--color-success-text); }
.dot-wrong { background: var(--color-error-text); }
</style>

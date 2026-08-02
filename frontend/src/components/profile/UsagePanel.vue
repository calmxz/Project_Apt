<template>
  <div class="usage" data-testid="usage-panel">
    <h2 class="section-title">
      <i class="pi pi-wallet col-icon" aria-hidden="true" />
      Usage
    </h2>

    <p v-if="noSpend" class="muted" data-testid="usage-empty">
      No usage yet — spend history appears once you start chatting.
    </p>

    <template v-else>
      <p class="glance-line" data-testid="usage-glance">
        Today ${{ usage.today_spend_usd.toFixed(2) }} · Last 7 days ${{ last7.toFixed(2) }}
      </p>

      <div class="meter-wrap">
        <div
          class="meter"
          role="img"
          :aria-label="`Today: $${usage.today_spend_usd.toFixed(2)} of $${usage.hard_cap_usd.toFixed(2)} daily cap`"
        >
          <span class="meter-fill" :style="{ width: fillPct }" />
          <span
            class="tier-marker"
            :style="{ left: markerPct(usage.soft_cap_usd) }"
            :title="`soft cap $${usage.soft_cap_usd.toFixed(2)}`"
          />
          <span
            class="tier-marker"
            :style="{ left: markerPct(usage.urgent_cap_usd) }"
            :title="`urgent cap $${usage.urgent_cap_usd.toFixed(2)}`"
          />
        </div>
        <span class="meter-caption">
          Today ${{ usage.today_spend_usd.toFixed(2) }} / ${{ usage.hard_cap_usd.toFixed(2) }} cap
        </span>
      </div>
    </template>

    <div v-if="usage.top_sessions.length" class="top-sessions">
      <h3 class="sub-title">Most expensive sessions</h3>
      <ul class="top-list">
        <li v-for="t in usage.top_sessions" :key="t.session_id" class="top-row">
          <router-link
            :to="{ name: 'session-profile', params: { id: t.session_id } }"
            class="top-link"
          >
            <span class="top-topic">{{ t.topic || 'untitled' }}</span>
            <span class="top-cost">${{ t.cost_usd.toFixed(2) }}</span>
          </router-link>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  usage: { type: Object, required: true },
})

const maxDay = computed(() => Math.max(...props.usage.daily.map((d) => d.cost_usd), 0))

const noSpend = computed(() => maxDay.value === 0 && props.usage.today_spend_usd === 0)

const last7 = computed(() => props.usage.daily.slice(-7).reduce((acc, d) => acc + d.cost_usd, 0))

const pctOfHard = (v) => `${Math.min(100, Math.round((v / props.usage.hard_cap_usd) * 100))}%`

const fillPct = computed(() => pctOfHard(props.usage.today_spend_usd))
const markerPct = (v) => pctOfHard(v)
</script>

<style scoped>
.usage {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
  margin: 0;
}

.col-icon {
  font-size: 1.05rem;
  color: var(--color-accent-text);
}

.muted {
  color: var(--color-text-muted);
}

.glance-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  color: var(--color-text-muted);
}

.meter-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.meter {
  position: relative;
  height: 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.meter-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent-coral-400);
}

.tier-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-border-strong);
}

.meter-caption {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.sub-title {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0 0 0.5rem 0;
}

.top-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.top-row {
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

.top-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  color: inherit;
  text-decoration: none;
}

.top-topic {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--color-heading);
}

.top-cost {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
</style>

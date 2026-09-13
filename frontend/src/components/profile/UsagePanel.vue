<template>
  <div class="usage" data-testid="usage-panel">
    <h2 class="heading">Usage</h2>

    <p v-if="noSpend" class="muted" data-testid="usage-empty">
      No usage yet — spend history appears once you start chatting.
    </p>

    <template v-else>
      <p class="glance-line" data-testid="usage-glance" data-tabular>
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
        <span class="meter-caption" data-tabular>
          Today ${{ usage.today_spend_usd.toFixed(2) }} / ${{ usage.hard_cap_usd.toFixed(2) }} cap
        </span>
      </div>

      <div v-if="ledger.length" class="ledger" data-testid="usage-ledger">
        <h3 class="sub-title">Last 7 days</h3>
        <ul class="ledger-list">
          <li
            v-for="d in ledger"
            :key="d.date_utc"
            class="ledger-row"
            data-testid="usage-ledger-row"
          >
            <span class="ledger-date">{{ d.label }}</span>
            <span class="ledger-cost" data-tabular>${{ d.cost_usd.toFixed(2) }}</span>
          </li>
        </ul>
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
            <span class="top-cost" data-tabular>${{ t.cost_usd.toFixed(2) }}</span>
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

const noSpend = computed(
  () =>
    maxDay.value === 0 &&
    props.usage.today_spend_usd === 0 &&
    (props.usage.top_sessions || []).length === 0,
)

const last7 = computed(() => props.usage.daily.slice(-7).reduce((acc, d) => acc + d.cost_usd, 0))

const pctOfHard = (v) => `${Math.min(100, Math.round((v / props.usage.hard_cap_usd) * 100))}%`

const fillPct = computed(() => pctOfHard(props.usage.today_spend_usd))
const markerPct = (v) => pctOfHard(v)

function formatDay(iso) {
  try {
    const d = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  } catch {
    return iso
  }
}

const ledger = computed(() =>
  props.usage.daily
    .slice(-7)
    .slice()
    .reverse()
    .map((d) => ({ ...d, label: formatDay(d.date_utc) })),
)
</script>

<style scoped>
/* The ledger page: today against the cap as one ruled line, the last seven
   days as dated rows, the costliest sessions under them. */
.usage {
  display: flex;
  flex-direction: column;
}

.heading {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.muted {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.glance-line {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.meter-wrap {
  display: flex;
  flex-direction: column;
  padding: 13px 0;
}

.meter {
  position: relative;
  height: 2px;
  background: var(--rule);
}

.meter-fill {
  display: block;
  height: 100%;
  background: var(--ink-learner);
}

.tier-marker {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--pencil);
}

.meter-caption {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.sub-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.ledger {
  display: flex;
  flex-direction: column;
  padding-top: var(--line-pitch);
}

.ledger-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ledger-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0 0.25rem 0 0;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.ledger-date {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
}

.ledger-cost {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.top-sessions {
  padding-top: var(--line-pitch);
}

.top-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* Contents rows: a ruled line each, the rule painted so the row stays on the
   pitch. */
.top-row {
  box-shadow: inset 0 -1px 0 var(--rule);
}

.top-link {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 0.25rem 0 0;
  color: inherit;
  text-decoration: none;
}

.top-link:hover .top-topic {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.top-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.top-topic {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.top-cost {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}
</style>

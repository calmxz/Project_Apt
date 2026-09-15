<template>
  <div class="usage" data-testid="usage-panel">
    <h2 class="heading">Usage</h2>

    <p v-if="noSpend" class="muted" data-testid="usage-empty">
      No usage yet — spend history appears once you start chatting.
    </p>

    <template v-else>
      <div class="glance" data-testid="usage-glance" data-tabular>
        <div class="glance-today">
          <span class="glance-figure">${{ usage.today_spend_usd.toFixed(2) }}</span>
          <span class="glance-caption">today · ${{ usage.hard_cap_usd.toFixed(2) }} daily cap</span>
        </div>
        <span class="glance-week">Last 7 days ${{ last7.toFixed(2) }}</span>
      </div>

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
        <div class="meter-labels" data-tabular>
          <span
            class="meter-label meter-label-soft"
            :style="{ left: markerPct(usage.soft_cap_usd) }"
            >soft ${{ usage.soft_cap_usd.toFixed(2) }}</span
          >
          <span
            class="meter-label meter-label-urgent"
            :style="{ left: markerPct(usage.urgent_cap_usd) }"
            >urgent ${{ usage.urgent_cap_usd.toFixed(2) }}</span
          >
        </div>
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
            <span class="ledger-bar-cell">
              <span
                class="ledger-bar"
                :class="{ 'ledger-bar--filled': d.cost_usd > 0 }"
                :style="{ width: barPct(d.cost_usd) }"
              />
            </span>
            <span class="ledger-cost" data-tabular>${{ d.cost_usd.toFixed(2) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <div v-if="usage.top_sessions.length" class="top-sessions">
      <h3 class="sub-title">Most expensive sessions</h3>
      <ul class="top-list">
        <li v-for="(t, i) in usage.top_sessions" :key="t.session_id" class="top-row">
          <router-link
            :to="{ name: 'session-profile', params: { id: t.session_id } }"
            class="top-link"
          >
            <span class="top-rank">{{ i + 1 }}.</span>
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

function barPct(cost) {
  if (cost <= 0) return '0%'
  const denom = Math.max(maxDay.value, 0.01)
  return `${Math.min(100, Math.round((cost / denom) * 100))}%`
}

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
  width: 100%;
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

.glance {
  display: flex;
  flex-direction: column;
}

.glance-today {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.glance-figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  font-weight: 600;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.glance-caption {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.glance-week {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.meter-wrap {
  display: flex;
  flex-direction: column;
  padding: 12px 0;
}

.meter {
  position: relative;
  height: 4px;
  background: var(--rule);
}

.meter-fill {
  display: block;
  height: 100%;
  background: var(--ink-learner);
}

.tier-marker {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 1px;
  background: var(--pencil);
}

.meter-labels {
  position: relative;
  height: var(--line-pitch);
}

.meter-label {
  position: absolute;
  top: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  white-space: nowrap;
}

/* Each tier label hangs off its own tick: soft to the right of its marker,
   urgent to the left, so neither can run past the meter's edge. The daily
   cap is already written in the glance caption. */
.meter-label-soft {
  transform: translateX(0.25rem);
}

.meter-label-urgent {
  transform: translateX(calc(-100% - 0.25rem));
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
  display: grid;
  grid-template-columns: 4.5rem minmax(4rem, 1fr) 4rem;
  align-items: center;
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

.ledger-bar-cell {
  display: block;
}

.ledger-bar {
  display: block;
  height: 6px;
  width: 0;
  background: var(--ink-learner);
}

.ledger-bar--filled {
  min-width: 2px;
}

.ledger-cost {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  text-align: right;
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
  display: grid;
  grid-template-columns: 1.5rem 1fr auto;
  align-items: baseline;
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

.top-rank {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.top-topic {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink-learner);
  overflow-wrap: anywhere;
  text-decoration: none;
}

.top-cost {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  text-align: right;
}

/* From 60rem up, the two ranked lists -- the last 7 days and the costliest
   sessions -- sit side by side divided by a strong rule; the today figure
   and meter stay full width above them. */
@media (min-width: 60rem) {
  .usage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 3rem;
  }

  .heading,
  .muted,
  .glance,
  .meter-wrap {
    grid-column: 1 / -1;
  }

  .top-sessions {
    padding-top: 0;
    border-left: 1px solid var(--rule-strong);
    padding-left: 3rem;
  }
}

@media (max-width: 600px) {
  .ledger-row {
    grid-template-columns: 4.5rem minmax(3rem, 1fr) 4rem;
  }

  .meter-labels {
    height: auto;
    min-height: var(--line-pitch);
  }

  .meter-label {
    position: static;
    display: inline-block;
    transform: none;
    margin-right: 0.75rem;
  }
}
</style>

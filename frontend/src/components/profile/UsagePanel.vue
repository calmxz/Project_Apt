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
        <div class="meter-row">
          <div class="meter-col">
            <div class="meter" role="img" data-testid="usage-meter" :aria-label="meterPctLabel">
              <span
                class="meter-fill"
                :class="{ 'meter-fill--over-urgent': overUrgent }"
                :style="{ width: fillPct }"
              />
              <span
                class="meter-tick"
                data-testid="usage-tick-soft"
                :style="{ left: pctOfHard(usage.soft_cap_usd) }"
                :title="`soft cap $${usage.soft_cap_usd.toFixed(2)}`"
              />
              <span
                class="meter-tick"
                data-testid="usage-tick-urgent"
                :style="{ left: pctOfHard(usage.urgent_cap_usd) }"
                :title="`urgent cap $${usage.urgent_cap_usd.toFixed(2)}`"
              />
              <span
                class="meter-tick meter-tick-hard"
                data-testid="usage-tick-hard"
                style="left: 100%"
                :title="`hard cap $${usage.hard_cap_usd.toFixed(2)}`"
              />
            </div>
            <div class="meter-labels" data-tabular>
              <span
                class="meter-label meter-label-soft"
                :style="{ left: pctOfHard(usage.soft_cap_usd) }"
                >soft ${{ usage.soft_cap_usd.toFixed(2) }}</span
              >
              <span
                class="meter-label meter-label-urgent"
                :style="{ left: pctOfHard(usage.urgent_cap_usd) }"
                >urgent ${{ usage.urgent_cap_usd.toFixed(2) }}</span
              >
            </div>
          </div>
          <span class="meter-figure" data-tabular
            >${{ usage.today_spend_usd.toFixed(2) }} of ${{
              usage.hard_cap_usd.toFixed(2)
            }}
            today</span
          >
        </div>
      </div>

      <!-- The chart is a picture of the ledger below: aria-hidden, with the
           ledger rows as its text equivalent. -->
      <div class="week" data-testid="usage-week">
        <h3 class="sub-title">This week</h3>
        <div class="week-figure">
          <div class="week-plot">
            <svg
              class="week-svg"
              :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            >
              <line
                class="week-baseline"
                :x1="0"
                :x2="PLOT_WIDTH"
                :y1="PLOT_BOTTOM"
                :y2="PLOT_BOTTOM"
              />
              <line
                class="cap-line"
                data-testid="usage-cap-line"
                :x1="0"
                :x2="PLOT_WIDTH"
                :y1="capLineY"
                :y2="capLineY"
              />
              <g
                v-for="col in weekColumns"
                :key="col.key"
                class="week-col"
                :class="{ 'week-col--today': col.isToday }"
                data-testid="usage-week-col"
                :data-today="col.isToday ? 'true' : 'false'"
              >
                <rect
                  v-if="col.barHeight > 0"
                  class="week-bar"
                  :x="col.x"
                  :y="col.barY"
                  :width="BAR_WIDTH"
                  :height="col.barHeight"
                  rx="4"
                  ry="4"
                />
                <rect
                  v-if="col.barHeight > 0"
                  class="week-bar"
                  :x="col.x"
                  :y="col.squareY"
                  :width="BAR_WIDTH"
                  :height="col.squareH"
                />
                <!-- Full-band hit target so every day, zero included, is
                     hoverable. -->
                <rect
                  class="week-hit"
                  data-testid="usage-week-hit"
                  :x="col.bandX"
                  :y="0"
                  :width="BAND_WIDTH"
                  :height="CHART_HEIGHT"
                  fill="transparent"
                >
                  <title>{{ col.fullLabel }}: ${{ col.value.toFixed(2) }}</title>
                </rect>
              </g>
            </svg>
            <span
              class="week-cap-label"
              data-testid="usage-cap-label"
              data-tabular
              aria-hidden="true"
              :style="{ top: capLabelTop }"
              >cap ${{ usage.hard_cap_usd.toFixed(2) }}</span
            >
          </div>
          <div class="week-labels" aria-hidden="true" :style="{ width: plotWidthPct }">
            <span v-for="col in weekColumns" :key="col.key" class="week-label">{{
              col.label
            }}</span>
          </div>
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

    <div v-if="topSessions.length" class="top-sessions">
      <h3 class="sub-title">Most expensive sessions</h3>
      <ul class="top-list">
        <li
          v-for="(t, i) in topSessions"
          :key="t.session_id"
          class="top-row"
          data-testid="usage-top-session"
        >
          <router-link
            :to="{ name: 'session-profile', params: { id: t.session_id } }"
            class="top-link"
          >
            <span class="top-rank">{{ i + 1 }}.</span>
            <span class="top-topic">{{ t.topic || 'untitled' }}</span>
            <span class="top-cost" data-tabular>${{ t.cost_usd.toFixed(2) }}</span>
          </router-link>
          <span class="top-bar-track">
            <span
              class="top-bar-fill"
              data-testid="usage-top-session-bar"
              :style="{ width: topBarPct(t.cost_usd) }"
            />
          </span>
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

// One reading of top_sessions for both the empty check and the list, so a
// payload without the key cannot make noSpend true and still throw in the
// template.
const topSessions = computed(() => props.usage.top_sessions || [])

const noSpend = computed(
  () => maxDay.value === 0 && props.usage.today_spend_usd === 0 && topSessions.value.length === 0,
)

const last7 = computed(() => props.usage.daily.slice(-7).reduce((acc, d) => acc + d.cost_usd, 0))

const pctOfHard = (v) => `${Math.min(100, Math.round((v / props.usage.hard_cap_usd) * 100))}%`

const fillPct = computed(() => pctOfHard(props.usage.today_spend_usd))

const overUrgent = computed(() => props.usage.today_spend_usd >= props.usage.urgent_cap_usd)

// The meter's one accessible name. It carries the percentage so it adds to,
// rather than repeats, the visible "$x.xx of $y.yy today" figure.
const meterPctLabel = computed(() => {
  const pct = Math.min(
    100,
    Math.round((props.usage.today_spend_usd / props.usage.hard_cap_usd) * 100),
  )
  return `${pct}% of daily cap spent`
})

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

function formatWeekday(iso) {
  try {
    const d = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  } catch {
    return ''
  }
}

const ledger = computed(() =>
  props.usage.daily
    .slice(-7)
    .reverse()
    .map((d) => ({ ...d, label: formatDay(d.date_utc) })),
)

const maxTopCost = computed(() => Math.max(...topSessions.value.map((t) => t.cost_usd), 0.01))

function topBarPct(cost) {
  if (cost <= 0) return '0%'
  return `${Math.min(100, Math.round((cost / maxTopCost.value) * 100))}%`
}

// Seven-day column chart. Always seven columns, oldest left, today
// rightmost: a payload with fewer than seven daily rows is padded at the
// front with zero-cost, unlabeled days rather than guessing a calendar date.
// The SVG holds marks only; weekday labels and the cap label are HTML so
// they stay at the type scale however wide the chart draws. A right gutter
// past the plot leaves room for the cap label.
const WEEK_COLS = 7
const PLOT_WIDTH = 336
const CAP_GUTTER = 72
const CHART_WIDTH = PLOT_WIDTH + CAP_GUTTER
// Top inset keeps a cap line at the top of the plot fully inside the SVG.
const PLOT_TOP = 8
const PLOT_HEIGHT = 88
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT
const CHART_HEIGHT = PLOT_BOTTOM + 1
const BAND_WIDTH = PLOT_WIDTH / WEEK_COLS
const BAR_WIDTH = 24
const SQUARE_H = 4

const plotWidthPct = `${(PLOT_WIDTH / CHART_WIDTH) * 100}%`

const weekDays = computed(() => {
  const real = props.usage.daily.slice(-WEEK_COLS)
  const padCount = Math.max(0, WEEK_COLS - real.length)
  const padded = Array.from({ length: padCount }, (_, i) => ({
    date_utc: null,
    cost_usd: 0,
    key: `pad-${i}`,
  }))
  const withKeys = real.map((d) => ({ ...d, key: d.date_utc }))
  return [...padded, ...withKeys]
})

// y max = max(hard cap, max daily value) so the cap line is always inside
// the plot rather than clipped off the top when the week ran over it.
const weekYMax = computed(() => {
  const maxVal = Math.max(...weekDays.value.map((d) => d.cost_usd), 0)
  return Math.max(props.usage.hard_cap_usd, maxVal, 0.01)
})

const weekColumns = computed(() =>
  weekDays.value.map((d, i) => {
    const frac = Math.max(0, Math.min(1, d.cost_usd / weekYMax.value))
    const barHeight = frac * PLOT_HEIGHT
    const barY = PLOT_BOTTOM - barHeight
    const squareH = Math.min(SQUARE_H, barHeight)
    const bandX = i * BAND_WIDTH
    const x = bandX + (BAND_WIDTH - BAR_WIDTH) / 2
    return {
      key: d.key,
      label: d.date_utc ? formatWeekday(d.date_utc) : '',
      fullLabel: d.date_utc ? formatDay(d.date_utc) : 'No data',
      value: d.cost_usd,
      isToday: i === WEEK_COLS - 1,
      bandX,
      x,
      barY,
      barHeight,
      squareY: barY + barHeight - squareH,
      squareH,
    }
  }),
)

const capLineY = computed(() => {
  const frac = Math.max(0, Math.min(1, props.usage.hard_cap_usd / weekYMax.value))
  return PLOT_BOTTOM - frac * PLOT_HEIGHT
})

// The HTML cap label rides the cap line: its top as a share of the SVG
// height, centred on the line by a translateY(-50%) in CSS.
const capLabelTop = computed(() => `${(capLineY.value / CHART_HEIGHT) * 100}%`)
</script>

<style scoped>
/* The ledger page: today against the cap as one ruled line, the seven-day
   column chart, the last seven days as dated rows, the costliest sessions
   under them. */
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

.meter-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* The meter and its tier labels share one column so a label's left: pct%
   lands on its tick; the figure sits beside the column, not under it. The
   top padding centres the 4px meter on the figure's line. */
.meter-col {
  flex: 1 1 auto;
  min-width: 6rem;
  padding-top: calc((var(--line-pitch) - 4px) / 2);
}

.meter {
  position: relative;
  height: 4px;
  background: var(--rule);
}

.meter-fill {
  display: block;
  height: 100%;
  background: var(--color-accent);
}

.meter-fill--over-urgent {
  background: var(--ink-marker-text);
}

.meter-tick {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 1px;
  background: var(--pencil);
}

.meter-figure {
  flex: 0 0 auto;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--ink);
  white-space: nowrap;
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

.week {
  padding-top: var(--line-pitch);
}

/* Capped measure: the chart must not scale with the sheet. */
.week-figure {
  max-width: 24rem;
  margin-top: 0.25rem;
}

.week-plot {
  position: relative;
}

.week-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.week-baseline {
  stroke: var(--rule);
  stroke-width: 1;
}

.cap-line {
  stroke: var(--pencil);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}

.week-bar {
  fill: var(--chart-bar-past);
}

/* Today uses --color-accent, not the spec's --color-accent-strong: in dark
   accent-strong (3.16:1) would draw today fainter than the past days. */
.week-col--today .week-bar {
  fill: var(--color-accent);
}

.week-cap-label {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: 1;
  color: var(--pencil);
  white-space: nowrap;
}

.week-labels {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.week-label {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
  text-align: center;
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
  background: var(--color-accent);
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
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.25rem 0;
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

.top-bar-track {
  display: block;
  height: 6px;
  background: var(--rule);
}

.top-bar-fill {
  display: block;
  height: 100%;
  width: 0;
  background: var(--color-accent);
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
  .meter-wrap,
  .week {
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

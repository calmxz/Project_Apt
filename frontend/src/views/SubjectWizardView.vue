<template>
  <section class="wizard">
    <!-- ─── Title step ─── -->
    <template v-if="step === 'title'">
      <h1 class="wizard-heading">New Subject</h1>
      <div class="wizard-field">
        <label for="wizard-title-input" class="sr-only">Subject title</label>
        <input
          id="wizard-title-input"
          v-model="title"
          data-testid="wizard-title-input"
          class="wizard-input"
          placeholder="e.g. Organic Chemistry"
          autocomplete="off"
        />
      </div>
      <div class="wizard-nav">
        <button
          type="button"
          data-testid="wizard-next"
          class="wizard-btn wizard-btn--primary"
          :disabled="!title.trim()"
          @click="step = 'duration'"
        >
          Next
        </button>
      </div>
    </template>

    <!-- ─── Duration step ─── -->
    <template v-else-if="step === 'duration'">
      <h2 class="wizard-heading">Session duration</h2>

      <!-- Minutes chips -->
      <div class="wizard-chip-group" role="group" aria-label="Minutes per session">
        <button
          v-for="mins in [15, 30, 60]"
          :key="mins"
          type="button"
          :data-testid="`wizard-minutes-${mins}`"
          class="wizard-chip"
          :class="{ active: selectedMinutes === mins }"
          :aria-pressed="String(selectedMinutes === mins)"
          @click="selectedMinutes = mins"
        >
          {{ mins }} min
        </button>
      </div>

      <!-- Duration-mode toggle -->
      <div class="wizard-toggle" role="group" aria-label="Duration mode">
        <button
          type="button"
          data-testid="wizard-duration-mode-deadline"
          class="wizard-toggle-btn"
          :class="{ active: durationMode === 'deadline' }"
          :aria-pressed="String(durationMode === 'deadline')"
          @click="durationMode = 'deadline'"
        >
          By deadline
        </button>
        <button
          type="button"
          data-testid="wizard-duration-mode-pace"
          class="wizard-toggle-btn"
          :class="{ active: durationMode === 'pace' }"
          :aria-pressed="String(durationMode === 'pace')"
          @click="durationMode = 'pace'"
        >
          By pace
        </button>
      </div>

      <!-- Deadline knob: timeline chips -->
      <template v-if="durationMode === 'deadline'">
        <div class="wizard-chip-group" role="group" aria-label="Target timeline">
          <button
            v-for="days in [7, 14, 30]"
            :key="days"
            type="button"
            :data-testid="`wizard-timeline-${days}`"
            class="wizard-chip"
            :class="{ active: selectedTimeline === days }"
            :aria-pressed="String(selectedTimeline === days)"
            @click="selectedTimeline = days"
          >
            {{ days }} days
          </button>
        </div>
      </template>

      <!-- Pace knob: stepper -->
      <template v-else>
        <div class="wizard-pace-stepper" data-testid="wizard-pace-stepper">
          <button
            type="button"
            data-testid="wizard-pace-dec"
            class="wizard-pace-btn"
            :disabled="pacePerWeek <= 1"
            @click="decPace"
          >
            &minus;
          </button>
          <span data-testid="wizard-pace-value" class="wizard-pace-val">{{ pacePerWeek }}</span>
          <button
            type="button"
            data-testid="wizard-pace-inc"
            class="wizard-pace-btn"
            :disabled="pacePerWeek >= 5"
            @click="incPace"
          >
            +
          </button>
          <span class="wizard-pace-label">lessons / week</span>
        </div>
      </template>

      <div class="wizard-nav">
        <button type="button" data-testid="wizard-back" class="wizard-btn" @click="step = 'title'">
          Back
        </button>
        <button
          type="button"
          data-testid="wizard-create"
          class="wizard-btn wizard-btn--primary"
          @click="commitCreate"
        >
          Create subject
        </button>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSubjectStore } from '../stores/subject.js'

const router = useRouter()
const store = useSubjectStore()

// Step state machine: 'title' | 'duration'
const step = ref('title')

// Title step
const title = ref('')

// Duration step
const selectedMinutes = ref(30)
const durationMode = ref('deadline')
const selectedTimeline = ref(14)
const pacePerWeek = ref(3)

function incPace() {
  if (pacePerWeek.value < 5) pacePerWeek.value++
}

function decPace() {
  if (pacePerWeek.value > 1) pacePerWeek.value--
}

// Only the pinned duration knob is sent.
function durationPayload() {
  return durationMode.value === 'deadline'
    ? { duration_mode: 'deadline', timeline_days: selectedTimeline.value }
    : { duration_mode: 'pace', pace_per_week: pacePerWeek.value }
}

function basePayload() {
  return { title: title.value.trim(), per_session_minutes: selectedMinutes.value, ...durationPayload() }
}

async function commitCreate() {
  const subject = await store.createSubject(basePayload())
  if (subject) router.push({ name: 'subject-overview', params: { id: subject.id } })
}
</script>

<style scoped>
.wizard {
  max-width: 560px;
  margin: 2rem auto;
  padding: 1.5rem;
}

.wizard-heading {
  margin-block: 0 1.25rem;
  font-size: 1.375rem;
  font-weight: 600;
  color: var(--color-heading);
}

.wizard-field {
  margin-block-end: 1rem;
}

.wizard-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 1rem;
  outline: none;
  box-sizing: border-box;
}

.wizard-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-ring);
}

/* Chip groups */
.wizard-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block-end: 1rem;
}

.wizard-chip {
  padding: 0.375rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.wizard-chip:hover {
  border-color: var(--color-accent-soft);
}

.wizard-chip.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

/* Duration-mode toggle */
.wizard-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  overflow: hidden;
  margin-block-end: 1rem;
}

.wizard-toggle-btn {
  flex: 1;
  padding: 0.375rem 1rem;
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s, color 0.15s;
}

.wizard-toggle-btn.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

/* Pace stepper */
.wizard-pace-stepper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-block-end: 1rem;
}

.wizard-pace-btn {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.wizard-pace-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.wizard-pace-val {
  min-width: 1.5rem;
  text-align: center;
  font-weight: 600;
}

.wizard-pace-label {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

/* Navigation row */
.wizard-nav {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.wizard-btn {
  padding: 0.5rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.9375rem;
}

.wizard-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-text-on-accent);
}

.wizard-btn--primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>

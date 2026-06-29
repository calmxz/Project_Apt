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

      <!-- Derived label (display-only) -->
      <p data-testid="wizard-derived" class="wizard-derived">{{ derivedLabel }}</p>

      <div class="wizard-nav">
        <button type="button" data-testid="wizard-back" class="wizard-btn" @click="step = 'title'">
          Back
        </button>
        <button
          type="button"
          data-testid="wizard-next"
          class="wizard-btn wizard-btn--primary"
          @click="step = 'source'"
        >
          Next
        </button>
      </div>
    </template>

    <!-- ─── Plan-source step ─── -->
    <template v-else-if="step === 'source'">
      <h2 class="wizard-heading">How do you want to build the lesson plan?</h2>
      <div v-if="drafting" data-testid="wizard-drafting" class="wizard-drafting" aria-busy="true">
        Drafting plan...
      </div>
      <div v-else class="wizard-source-row">
        <button
          type="button"
          data-testid="wizard-mode-draft"
          class="wizard-source-btn"
          @click="chooseDraft"
        >
          Draft with AI
        </button>
        <button
          type="button"
          data-testid="wizard-mode-blank"
          class="wizard-source-btn"
          @click="chooseBlank"
        >
          Start blank
        </button>
      </div>
      <div class="wizard-nav">
        <button type="button" data-testid="wizard-back" class="wizard-btn" @click="step = 'duration'">
          Back
        </button>
      </div>
    </template>

    <!-- ─── Editor step ─── -->
    <template v-else-if="step === 'editor'">
      <h2 class="wizard-heading">Review lessons</h2>

      <!-- Draft error notice -->
      <p
        v-if="draftError"
        data-testid="wizard-draft-error"
        class="wizard-draft-error"
        role="alert"
      >
        {{ draftError }}
      </p>

      <!-- Editable lesson rows -->
      <div
        v-for="(lesson, i) in lessons"
        :key="i"
        :data-testid="`wizard-lesson-row-${i}`"
        class="wizard-lesson-row"
      >
        <input
          :data-testid="`wizard-row-title-${i}`"
          v-model="lessons[i].title"
          class="wizard-input wizard-row-input"
          placeholder="Lesson title"
        />
        <input
          :data-testid="`wizard-row-goal-${i}`"
          v-model="lessons[i].goal"
          class="wizard-input wizard-row-input"
          placeholder="Learning goal"
        />
        <div class="wizard-row-actions">
          <button
            type="button"
            :data-testid="`wizard-lesson-up-${i}`"
            class="wizard-row-btn"
            :disabled="i === 0"
            @click="moveLesson(i, -1)"
          >
            Up
          </button>
          <button
            type="button"
            :data-testid="`wizard-lesson-down-${i}`"
            class="wizard-row-btn"
            :disabled="i === lessons.length - 1"
            @click="moveLesson(i, 1)"
          >
            Down
          </button>
          <button
            type="button"
            :data-testid="`wizard-lesson-remove-${i}`"
            class="wizard-row-btn wizard-row-btn--remove"
            @click="removeLessonRow(i)"
          >
            Remove
          </button>
        </div>
      </div>

      <!-- Add row -->
      <div class="wizard-add-row">
        <input
          data-testid="wizard-lesson-title"
          v-model="lessonTitle"
          class="wizard-input wizard-row-input"
          placeholder="New lesson title"
        />
        <input
          data-testid="wizard-lesson-goal"
          v-model="lessonGoal"
          class="wizard-input wizard-row-input"
          placeholder="Learning goal (optional)"
        />
        <button
          type="button"
          data-testid="wizard-add-lesson"
          class="wizard-btn"
          :disabled="!lessonTitle.trim()"
          @click="addLessonRow"
        >
          Add lesson
        </button>
      </div>

      <!-- Derived label (live from lessons count) -->
      <p data-testid="wizard-derived" class="wizard-derived">{{ derivedLabel }}</p>

      <!-- Commit -->
      <div class="wizard-nav">
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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { derivePace, deriveHorizonWeeks } from '../utils/pace.js'
import { useSubjectStore } from '../stores/subject.js'

const router = useRouter()
const store = useSubjectStore()

// Step state machine: 'title' | 'duration' | 'source' | 'editor'
const step = ref('title')

// Title step
const title = ref('')

// Duration step
const selectedMinutes = ref(30)
const durationMode = ref('deadline')
const selectedTimeline = ref(14)
const pacePerWeek = ref(3)

// Lessons list — populated by chooseDraft or left empty by chooseBlank
const lessons = ref([])

// Add-row inputs
const lessonTitle = ref('')
const lessonGoal = ref('')

// Draft state
const drafting = ref(false)
const draftError = ref(null)

// Display-only derived label; updates when lessons or the active knob changes
const derivedLabel = computed(() => {
  if (durationMode.value === 'deadline') {
    return `~${derivePace(lessons.value.length, selectedTimeline.value)}/week`
  }
  return `~${deriveHorizonWeeks(lessons.value.length, pacePerWeek.value)} weeks`
})

function incPace() {
  if (pacePerWeek.value < 5) pacePerWeek.value++
}

function decPace() {
  if (pacePerWeek.value > 1) pacePerWeek.value--
}

function addLessonRow() {
  const t = lessonTitle.value.trim()
  if (!t) return
  lessons.value.push({ title: t, goal: lessonGoal.value.trim() })
  lessonTitle.value = ''
  lessonGoal.value = ''
}

function removeLessonRow(i) {
  lessons.value.splice(i, 1)
}

function moveLesson(i, delta) {
  const j = i + delta
  if (j < 0 || j >= lessons.value.length) return
  const arr = lessons.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

// Only the pinned duration knob is sent (Spec B §2 step 2).
function durationPayload() {
  return durationMode.value === 'deadline'
    ? { duration_mode: 'deadline', timeline_days: selectedTimeline.value }
    : { duration_mode: 'pace', pace_per_week: pacePerWeek.value }
}

function basePayload() {
  return { title: title.value.trim(), per_session_minutes: selectedMinutes.value, ...durationPayload() }
}

async function chooseDraft() {
  drafting.value = true
  draftError.value = null
  try {
    const drafted = await store.draftPlan(basePayload())
    lessons.value = (drafted || []).map((l) => ({ title: l.title, goal: l.goal }))
    step.value = 'editor'
  } catch {
    draftError.value = 'Could not draft a plan right now. Add lessons yourself below.'
    lessons.value = []
    step.value = 'editor'
  } finally {
    drafting.value = false
  }
}

function chooseBlank() {
  lessons.value = []
  step.value = 'editor'
}

async function commitCreate() {
  const subject = await store.createSubject({ ...basePayload(), mode: 'blank', lessons: lessons.value })
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

/* Derived display */
.wizard-derived {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  margin-block-end: 1.25rem;
}

/* Plan-source buttons */
.wizard-source-row {
  display: flex;
  gap: 1rem;
  margin-block-end: 1.5rem;
}

.wizard-source-btn {
  flex: 1;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.9375rem;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.wizard-source-btn:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* Drafting spinner */
.wizard-drafting {
  padding: 1rem 0;
  color: var(--color-text-muted);
  font-size: 0.9375rem;
  margin-block-end: 1rem;
}

/* Draft error notice */
.wizard-draft-error {
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.875rem;
  margin-block-end: 1rem;
}

/* Editor lesson rows */
.wizard-lesson-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  margin-block-end: 0.5rem;
}

.wizard-row-input {
  flex: 1;
  min-width: 8rem;
}

.wizard-row-actions {
  display: flex;
  gap: 0.375rem;
}

.wizard-row-btn {
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.8125rem;
}

.wizard-row-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.wizard-row-btn--remove {
  color: var(--color-text-muted);
}

/* Add row */
.wizard-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  margin-block-end: 1rem;
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

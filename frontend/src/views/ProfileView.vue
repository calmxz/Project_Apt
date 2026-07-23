<template>
  <section class="sprof" data-testid="session-profile">
    <BackButton label="Back to session" :fallback="`/session/${id}`" />

    <header class="head">
      <div class="head-text">
        <span class="folio">session profile</span>
        <h1 class="title">{{ topicLabel }}</h1>
        <p v-if="data?.profile?.knowledge_level" class="lede">
          Working at the
          <span class="level-pill" :data-level="data.profile.knowledge_level">{{
            data.profile.knowledge_level
          }}</span>
          level.
        </p>
      </div>

      <div v-if="data" class="header-actions">
        <button
          v-if="data.profile.confirmed_gaps?.length"
          type="button"
          class="review-gaps-btn"
          data-testid="sprof-review-gaps"
          @click="startReview"
        >
          <i class="pi pi-bullseye" aria-hidden="true" />
          Review gaps
        </button>

        <div class="level-edit" data-testid="level-select">
          <button
            v-for="lvl in LEVELS"
            :key="lvl"
            type="button"
            class="level-opt"
            :class="{ active: data.profile.knowledge_level === lvl }"
            @click="setLevel(lvl)"
          >
            {{ lvl }}
          </button>
        </div>
      </div>
    </header>

    <GapPickerDialog v-model:visible="gapPickerOpen" :gaps="gapNames" @select="goReview" />

    <div v-if="loading" class="skel" data-testid="sprof-loading" aria-hidden="true">
      <span class="skel-block skel-row-tall" />
      <span class="skel-block" />
      <span class="skel-block skel-short" />
    </div>
    <p v-else-if="error" class="error" data-testid="sprof-error">{{ error }}</p>

    <template v-else-if="data">
      <p v-if="conflict" class="conflict" data-testid="sprof-conflict" role="status">
        Profile changed elsewhere — reloaded with the latest.
      </p>
      <p v-if="writeError" class="error" data-testid="sprof-write-error" role="alert">
        {{ writeError }}
      </p>

      <div v-if="data.profile.focus_target_gap" class="focus" data-testid="sprof-focus">
        <span class="focus-icon" aria-hidden="true">
          <i class="pi pi-bullseye" />
        </span>
        <div class="focus-body">
          <span class="focus-label">Current focus</span>
          <span class="focus-gap">{{ data.profile.focus_target_gap }}</span>
        </div>
      </div>

      <div v-if="subtopicEntries.length" class="subtopics" data-testid="sprof-subtopics">
        <h2 class="section-title">
          <i class="pi pi-sliders-h col-icon" aria-hidden="true" />
          Subtopic levels
        </h2>
        <ul class="subtopic-list">
          <li v-for="[name, lvl] in subtopicEntries" :key="`st-${name}`" class="subtopic-row">
            <span class="st-name">{{ name }}</span>
            <div class="level-edit">
              <button
                v-for="l in LEVELS"
                :key="l"
                type="button"
                class="level-opt"
                :class="{ active: lvl === l }"
                @click="setSubtopicLevel(name, l)"
              >
                {{ l }}
              </button>
            </div>
            <button
              type="button"
              class="chip-x"
              data-testid="subtopic-remove"
              :aria-label="`Remove ${name}`"
              @click="removeSubtopic(name)"
            >
              <i class="pi pi-times" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>

      <div class="two-col">
        <div class="col" data-testid="sprof-mastered">
          <h2 class="section-title">
            <i class="pi pi-check-circle col-icon col-icon-green" aria-hidden="true" />
            Mastered
          </h2>
          <p v-if="!data.profile.mastered_concepts?.length" class="muted">Nothing recorded yet.</p>
          <ul v-else class="chip-list">
            <li
              v-for="c in data.profile.mastered_concepts"
              :key="`m-${c.name}`"
              class="chip chip-mastered"
            >
              {{ c.name }}
              <span v-if="c.evidence_type" class="chip-badge" data-testid="evidence-badge">
                {{ c.evidence_type }}
              </span>
              <button
                type="button"
                class="chip-x"
                data-testid="chip-remove"
                :aria-label="`Remove ${c.name}`"
                @click="removeItem('mastered_concepts', c.name)"
              >
                <i class="pi pi-times" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <div class="add-row">
            <input
              v-model="newMastered"
              data-testid="add-mastered"
              class="add-input"
              placeholder="Add a concept"
              maxlength="200"
              @keydown.enter="addMastered"
            />
            <button
              type="button"
              data-testid="add-mastered-submit"
              class="add-btn"
              aria-label="Add concept"
              @click="addMastered"
            >
              Add
            </button>
          </div>
        </div>

        <div class="col" data-testid="sprof-gaps">
          <h2 class="section-title">
            <i class="pi pi-bolt col-icon col-icon-yellow" aria-hidden="true" />
            Confirmed gaps
          </h2>
          <p v-if="!data.profile.confirmed_gaps?.length" class="muted">None.</p>
          <ul v-else class="chip-list">
            <li v-for="g in data.profile.confirmed_gaps" :key="`g-${g.name}`" class="chip chip-gap">
              {{ g.name }}
              <span v-if="g.evidence_type" class="chip-badge" data-testid="evidence-badge">
                {{ g.evidence_type }}
              </span>
              <button
                type="button"
                class="chip-x"
                data-testid="chip-remove"
                :aria-label="`Remove ${g.name}`"
                @click="removeItem('confirmed_gaps', g.name)"
              >
                <i class="pi pi-times" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <div class="add-row">
            <input
              v-model="newGap"
              data-testid="add-gap"
              class="add-input"
              placeholder="Add a gap"
              maxlength="200"
              @keydown.enter="addGap"
            />
            <button
              type="button"
              data-testid="add-gap-submit"
              class="add-btn"
              aria-label="Add gap"
              @click="addGap"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div v-if="data.profile.last_session_summary" class="summary" data-testid="sprof-summary">
        <h2 class="section-title">Session summary</h2>
        <div class="summary-card">
          <p class="summary-text">{{ stripAutoPrefix(data.profile.last_session_summary) }}</p>
        </div>
      </div>

      <div class="events" data-testid="sprof-events">
        <h2 class="section-title">Recent check-questions</h2>
        <p v-if="!data.recent_learning_events.length" class="muted">
          No learning events logged yet.
        </p>
        <ol v-else class="event-list">
          <li
            v-for="ev in data.recent_learning_events"
            :key="ev.id"
            :class="['event-row', ev.correct ? 'evt-ok' : 'evt-bad']"
          >
            <div class="event-head">
              <span class="event-gap">{{ ev.gap_tested }}</span>
              <span class="event-mark" :aria-label="ev.correct ? 'correct' : 'missed'">
                <i :class="['pi', ev.correct ? 'pi-check' : 'pi-times']" aria-hidden="true" />
              </span>
            </div>
            <p class="event-q">{{ ev.question }}</p>
            <span class="event-when">{{ formatRelative(ev.created_at) }}</span>
          </li>
        </ol>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import BackButton from '../components/BackButton.vue'
import GapPickerDialog from '../components/GapPickerDialog.vue'
import { friendlyError } from '../lib/errors.js'
import { deleteProfileItem, getSessionProfile, patchProfile } from '../services/profileApi.js'
import { useSessionStore } from '../stores/session.js'
import { formatRelative } from '../utils/formatDate.js'
import { stripAutoPrefix } from '../utils/sessionCard.js'

const props = defineProps({ id: { type: String, required: true } })

const LEVELS = ['beginner', 'intermediate', 'advanced']

const router = useRouter()
const store = useSessionStore()
const data = ref(null)
const loading = ref(false)
const error = ref('')
const etag = ref('')
const conflict = ref(false)
// F-05: write failures get their own ref. Reusing the load-path `error`
// would swap the whole loaded profile for an error paragraph (the template
// chain is loading -> error -> data) with no control left to retry.
const writeError = ref('')
const newMastered = ref('')
const newGap = ref('')
const gapPickerOpen = ref(false)

const topicLabel = computed(() => {
  const fromStore = store.sessions.find((s) => s.id === props.id)?.topic
  return fromStore || store.currentSession?.topic || 'Session profile'
})

const gapNames = computed(() => (data.value?.profile?.confirmed_gaps ?? []).map((g) => g.name))

const subtopicEntries = computed(() => Object.entries(data.value?.profile?.subtopic_levels ?? {}))

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getSessionProfile(props.id)
    etag.value = data.value.etag
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

async function _applyWrite(fn) {
  conflict.value = false
  writeError.value = ''
  try {
    const res = await fn()
    data.value = { ...data.value, profile: res.profile }
    etag.value = res.etag
  } catch (e) {
    if (e?.status === 412) {
      conflict.value = true
      await load()
    } else {
      writeError.value = friendlyError(e)
    }
  }
}

function addMastered() {
  const v = newMastered.value.trim()
  if (!v) return
  newMastered.value = ''
  return _applyWrite(() => patchProfile(props.id, { add_mastered: v }, etag.value))
}

function addGap() {
  const v = newGap.value.trim()
  if (!v) return
  newGap.value = ''
  return _applyWrite(() => patchProfile(props.id, { add_gap: v }, etag.value))
}

function setLevel(level) {
  return _applyWrite(() => patchProfile(props.id, { knowledge_level: level }, etag.value))
}

function removeItem(listName, item) {
  return _applyWrite(() => deleteProfileItem(props.id, listName, item, etag.value))
}

function setSubtopicLevel(name, level) {
  return _applyWrite(() =>
    patchProfile(props.id, { subtopic: name, subtopic_level: level }, etag.value),
  )
}

function removeSubtopic(name) {
  return _applyWrite(() => deleteProfileItem(props.id, 'subtopic_levels', name, etag.value))
}

function startReview() {
  if (gapNames.value.length > 1) gapPickerOpen.value = true
  else if (gapNames.value.length === 1) goReview(gapNames.value[0])
}

function goReview(gap) {
  router.push({ name: 'session', params: { id: props.id }, query: { review_gap: gap } })
}

onMounted(load)
</script>

<style scoped>
.sprof {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(1.875rem, 4vw, 2.25rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 1rem;
}

.level-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.625rem;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: capitalize;
  border: 1px solid transparent;
}

.level-pill[data-level='beginner'] {
  background: rgba(91, 141, 239, 0.16);
  color: var(--color-info-text);
  border-color: rgba(91, 141, 239, 0.3);
}
:root[data-theme='dark'] .level-pill[data-level='beginner'] {
  color: #7aa3f5;
}

.level-pill[data-level='intermediate'] {
  background: var(--accent-coral-100);
  color: var(--accent-coral-700);
  border-color: var(--accent-coral-200);
}
:root[data-theme='dark'] .level-pill[data-level='intermediate'] {
  background: rgba(255, 119, 102, 0.2);
  color: var(--accent-coral-300);
  border-color: rgba(255, 119, 102, 0.35);
}

.level-pill[data-level='advanced'] {
  background: rgba(34, 197, 94, 0.16);
  color: var(--color-success-text);
  border-color: rgba(34, 197, 94, 0.3);
}
:root:not([data-theme='dark']) .level-pill[data-level='advanced'] {
  color: var(--color-success-text);
}

.level-pill[data-level='unknown'] {
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.muted {
  color: var(--color-text-muted);
}
.error {
  color: var(--color-error-text);
}

/* Focus */
.focus {
  display: inline-flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1.125rem;
  background: linear-gradient(135deg, var(--accent-coral-100) 0%, var(--accent-coral-50) 100%);
  border: 1px solid var(--accent-coral-200);
  border-radius: var(--radius-lg);
  align-self: flex-start;
  box-shadow: var(--shadow-paper);
}

:root[data-theme='dark'] .focus {
  background: linear-gradient(135deg, rgba(255, 107, 92, 0.18) 0%, rgba(255, 107, 92, 0.08) 100%);
  border-color: rgba(255, 107, 92, 0.35);
}

.focus-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #ffffff;
  font-size: 1rem;
  flex-shrink: 0;
}

.focus-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.focus-label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--accent-coral-700);
}
:root[data-theme='dark'] .focus-label {
  color: var(--accent-coral-300);
}

.focus-gap {
  font-family: var(--font-display);
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
}

/* Section title */
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
}
.col-icon-green {
  color: var(--color-success-text);
}
.col-icon-yellow {
  color: var(--color-warning-text);
}

.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 2rem;
}

/* Chips */
.chip-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid transparent;
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.chip:hover {
  transform: translateY(-1px);
}

.chip-mastered {
  background: rgba(34, 197, 94, 0.14);
  color: var(--color-success-text);
  border-color: rgba(34, 197, 94, 0.3);
}
:root:not([data-theme='dark']) .chip-mastered {
  color: var(--color-success-text);
}

.chip-gap {
  background: rgba(255, 176, 32, 0.16);
  color: var(--color-warning-text);
  border-color: rgba(255, 176, 32, 0.35);
}
:root[data-theme='dark'] .chip-gap {
  color: var(--signal-warning);
}

/* Summary card */
.summary-card {
  padding: 1.125rem 1.25rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-paper);
}

.summary-text {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

/* Events */
.event-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.event-row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.875rem 1.125rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-paper);
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.event-row:hover {
  transform: translateY(-1px);
}

.evt-ok {
  border-left: 3px solid var(--signal-success);
}
.evt-bad {
  border-left: 3px solid var(--signal-warning);
}

.event-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.event-gap {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
}

.event-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-pill);
  font-size: 0.7rem;
  color: #ffffff;
}

.evt-ok .event-mark {
  background: var(--signal-success);
}
.evt-bad .event-mark {
  background: var(--signal-warning);
  color: #2a1f00;
}

.event-q {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
  color: var(--color-heading);
  font-size: 1rem;
  letter-spacing: var(--tracking-tight);
}

.event-when {
  font-family: var(--font-sans);
  font-size: 0.75rem;
  color: var(--color-text-faint);
}

.chip-badge {
  margin-left: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}

/* Chip remove button */
.chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 0.375rem;
  padding: 0;
  width: 1.125rem;
  height: 1.125rem;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  border-radius: var(--radius-pill);
  opacity: 0.7;
  transition: opacity var(--motion-fast) var(--motion-bounce);
}
.chip-x:hover {
  opacity: 1;
}

/* Add-item row */
.add-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.add-input {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  background: var(--color-surface);
  color: var(--color-text);
}

.add-btn {
  padding: 0.4rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  background: var(--color-surface);
  color: var(--color-accent-strong);
  cursor: pointer;
}
.add-btn:hover {
  background: var(--color-surface-soft);
}

/* Header actions */
.header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.625rem;
}

.review-gaps-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.875rem;
  border: 1px solid var(--accent-coral-200);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 600;
  background: var(--accent-coral-100);
  color: var(--accent-coral-700);
  cursor: pointer;
  transition:
    transform var(--motion-fast) var(--motion-bounce),
    background var(--motion-fast) ease;
}

.review-gaps-btn:hover {
  transform: translateY(-1px);
  background: var(--accent-coral-200);
}

:root[data-theme='dark'] .review-gaps-btn {
  background: rgba(255, 119, 102, 0.18);
  color: var(--accent-coral-300);
  border-color: rgba(255, 119, 102, 0.35);
}
:root[data-theme='dark'] .review-gaps-btn:hover {
  background: rgba(255, 119, 102, 0.28);
}

/* Level control */
.level-edit {
  display: inline-flex;
  gap: 0.375rem;
}

.level-opt {
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: capitalize;
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}

.level-opt.active {
  background: var(--color-accent-strong);
  color: #ffffff;
  border-color: var(--color-accent-strong);
}

.subtopic-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.subtopic-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.875rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.st-name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

/* Conflict notice */
.conflict {
  margin: 0;
  padding: 0.625rem 1rem;
  border: 1px solid var(--color-error-text);
  border-radius: var(--radius-lg);
  color: var(--color-error-text);
  font-size: 0.875rem;
}

.skel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skel-block {
  height: 1.25rem;
  border-radius: var(--radius-md);
  background: var(--color-surface-soft);
  animation: skel-pulse 1.4s ease-in-out infinite;
}

.skel-row-tall {
  height: 5.5rem;
}

.skel-short {
  width: 55%;
}

@keyframes skel-pulse {
  0%,
  100% {
    opacity: 0.65;
  }
  50% {
    opacity: 0.35;
  }
}
</style>

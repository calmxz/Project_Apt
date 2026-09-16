<template>
  <section class="sprof" data-testid="session-profile">
    <BackButton label="Back to session" :fallback="`/session/${id}`" />

    <header class="head">
      <div class="head-text">
        <h1 class="title">{{ topicLabel }}</h1>
        <p v-if="data?.profile?.knowledge_level" class="lede">
          Working at the <span class="level-word">{{ data.profile.knowledge_level }}</span> level.
        </p>
      </div>

      <div v-if="data" class="header-actions">
        <button
          v-if="data.profile.confirmed_gaps?.length"
          type="button"
          class="text-btn"
          data-testid="sprof-review-gaps"
          @click="startReview"
        >
          Review gaps
        </button>
      </div>
    </header>

    <GapPickerDialog v-model:visible="gapPickerOpen" :gaps="gapNames" @select="goReview" />

    <div v-if="loading" class="skel" data-testid="sprof-loading" aria-hidden="true">
      <span class="skel-block" />
      <span class="skel-block" />
      <span class="skel-block skel-short" />
    </div>
    <span v-if="loading" class="sr-only" role="status">Loading</span>
    <p v-else-if="error" class="error" data-testid="sprof-error">{{ error }}</p>

    <template v-else-if="data">
      <p v-if="conflict" class="conflict" data-testid="sprof-conflict" role="status">
        Profile changed elsewhere — reloaded with the latest.
      </p>
      <p v-if="writeError" class="error" data-testid="sprof-write-error" role="alert">
        {{ writeError }}
      </p>

      <section class="divider divider--level" data-testid="sprof-level">
        <h2 class="divider-tab divider-tab--level">Level</h2>
        <div class="divider-body">
          <div class="level-edit" data-testid="level-select">
            <button
              v-for="lvl in LEVELS"
              :key="lvl"
              type="button"
              class="level-opt"
              :class="{ active: data.profile.knowledge_level === lvl }"
              @click="setLevel(lvl)"
            >
              <svg
                class="level-mark"
                viewBox="0 0 24 24"
                width="18"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(lvl)" />
              </svg>
              {{ lvl }}
            </button>
          </div>
        </div>
      </section>

      <section
        v-if="data.profile.focus_target_gap"
        class="divider divider--focus"
        data-testid="sprof-focus"
      >
        <h2 class="divider-tab divider-tab--focus">Focus</h2>
        <div class="divider-body">
          <p class="cue-entry cue-entry--focus">
            <svg
              class="cue-mark cue-mark--focus"
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M1 6 L11 6" />
            </svg>
            <span class="cue-word">{{ data.profile.focus_target_gap }}</span>
          </p>
        </div>
      </section>

      <section v-if="subtopicEntries.length" class="sec" data-testid="sprof-subtopics">
        <h2 class="sec-title">Subtopic levels</h2>
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
                <svg
                  class="level-mark"
                  viewBox="0 0 24 24"
                  width="18"
                  height="12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path :d="LEVEL_MARK_PATH" :stroke-width="levelStroke(l)" />
                </svg>
                {{ l }}
              </button>
            </div>
            <button
              type="button"
              class="icon-btn hit-44"
              data-testid="subtopic-remove"
              :aria-label="`Remove ${name}`"
              @click="removeSubtopic(name)"
            >
              <svg
                class="icon-mark"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 4 L12 12 M12 4 L4 12" />
              </svg>
            </button>
          </li>
        </ul>
      </section>

      <section class="divider divider--gaps" data-testid="sprof-gaps">
        <h2 class="divider-tab divider-tab--gaps">Gaps</h2>
        <div class="divider-body">
          <p v-if="!data.profile.confirmed_gaps?.length" class="cue-none">None.</p>
          <ul v-else class="cue-list">
            <li v-for="g in data.profile.confirmed_gaps" :key="`g-${g.name}`" class="chip">
              <svg
                class="cue-mark cue-mark--gap"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="6" cy="6" r="4" />
              </svg>
              <span class="cue-word">{{ g.name }}</span>
              <span v-if="g.evidence_type" class="chip-badge" data-testid="evidence-badge">
                {{ g.evidence_type }}
              </span>
              <button
                type="button"
                class="icon-btn hit-44"
                data-testid="chip-remove"
                :aria-label="`Remove ${g.name}`"
                @click="removeItem('confirmed_gaps', g.name)"
              >
                <svg
                  class="icon-mark"
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M4 4 L12 12 M12 4 L4 12" />
                </svg>
              </button>
            </li>
          </ul>
          <div class="add-row">
            <input
              v-model="newGap"
              data-testid="add-gap"
              class="add-input"
              placeholder="Add a gap"
              aria-label="Add a gap"
              maxlength="200"
              @keydown.enter="addGap"
            />
            <button
              type="button"
              data-testid="add-gap-submit"
              class="text-btn"
              aria-label="Add gap"
              @click="addGap"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      <section class="divider divider--mastered" data-testid="sprof-mastered">
        <h2 class="divider-tab divider-tab--mastered">Mastered</h2>
        <div class="divider-body">
          <p v-if="!data.profile.mastered_concepts?.length" class="cue-none">
            Nothing recorded yet.
          </p>
          <ul v-else class="cue-list">
            <li v-for="c in data.profile.mastered_concepts" :key="`m-${c.name}`" class="chip">
              <svg
                class="cue-mark cue-mark--tick"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M2 6.5 L4.8 9.2 L10 3.2" />
              </svg>
              <span class="cue-word">{{ c.name }}</span>
              <span v-if="c.evidence_type" class="chip-badge" data-testid="evidence-badge">
                {{ c.evidence_type }}
              </span>
              <button
                type="button"
                class="icon-btn hit-44"
                data-testid="chip-remove"
                :aria-label="`Remove ${c.name}`"
                @click="removeItem('mastered_concepts', c.name)"
              >
                <svg
                  class="icon-mark"
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M4 4 L12 12 M12 4 L4 12" />
                </svg>
              </button>
            </li>
          </ul>
          <div class="add-row">
            <input
              v-model="newMastered"
              data-testid="add-mastered"
              class="add-input"
              placeholder="Add a concept"
              aria-label="Add a mastered concept"
              maxlength="200"
              @keydown.enter="addMastered"
            />
            <button
              type="button"
              data-testid="add-mastered-submit"
              class="text-btn"
              aria-label="Add concept"
              @click="addMastered"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      <section
        v-if="data.profile.last_session_summary"
        class="sec sec--ruled"
        data-testid="sprof-summary"
      >
        <h2 class="sec-title">Session summary</h2>
        <p class="summary-text">{{ stripAutoPrefix(data.profile.last_session_summary) }}</p>
      </section>

      <section class="sec sec--ruled" data-testid="sprof-events">
        <h2 class="sec-title">Recent check-questions</h2>
        <p v-if="!data.recent_learning_events.length" class="cue-none">
          No learning events logged yet.
        </p>
        <ol v-else class="event-list">
          <li
            v-for="ev in data.recent_learning_events"
            :key="ev.id"
            :class="['event-row', ev.correct ? 'evt-ok' : 'evt-bad']"
          >
            <span class="event-mark" :aria-label="ev.correct ? 'correct' : 'missed'">
              <svg
                class="event-mark-draw"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path v-if="ev.correct" d="M3 8.5 L6.5 12 L13 4" />
                <path v-else d="M4 4 L12 12 M12 4 L4 12" />
              </svg>
            </span>
            <span class="event-body">
              <span class="event-gap">{{ ev.gap_tested }}</span>
              <span class="event-q">{{ ev.question }}</span>
              <span class="event-when">{{ formatRelative(ev.created_at) }}</span>
            </span>
          </li>
        </ol>
      </section>
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
import { LEVEL_MARK_PATH, levelStroke } from '../components/chat/levelMark.js'

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
/* The session profile is a stack of full-width cards: what the tutor knows
   about this session, editable in place. The four coloured dividers (Level,
   Focus, Gaps, Mastered) carry the profile's law-bound colours; the rest
   are plain white cards on the desk. */
.sprof {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--rule-strong);
}

.head-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.level-word {
  color: var(--ink);
}

.header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.sec {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1.25rem 1.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.sec--ruled {
  margin-top: 0;
}

.sec-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

/* The four full-width dividers: a coloured tab (law: red only Focus, amber
   only Gaps, green only Mastered; Level stays neutral) joined to a white
   card body, same grammar as the Settings rail + sheet. */
.divider {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.divider-tab {
  align-self: flex-start;
  margin: 0;
  padding: 0.375rem 1rem;
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  color: var(--tab-ink);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
}

.divider-tab--focus {
  background: var(--tab-focus);
}

.divider-tab--gaps {
  background: var(--tab-gaps);
}

.divider-tab--mastered {
  background: var(--tab-mastered);
}

.divider-tab--level {
  background: var(--tab-level);
}

.divider-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  width: 100%;
  padding: 1.25rem 1.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: 0 var(--radius-card) var(--radius-card) var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
}

.cue-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.chip,
.cue-entry {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
}

.cue-word {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink-learner);
  overflow-wrap: anywhere;
}

/* The focus cue stays in ink and is marked in red; the word is never set in
   red. */
.cue-entry--focus .cue-word {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.cue-mark {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 0.35rem;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.cue-mark--focus {
  stroke: var(--ink-marker);
  stroke-width: 2;
}

.cue-mark--gap {
  stroke: var(--pencil);
}

.cue-mark--tick {
  stroke: var(--ink-learner);
}

.cue-none {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.chip-badge {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

/* Controls: blue text, or a drawn stroke in an icon button. Nothing stamped. */
.text-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.text-btn:hover:not(:disabled) {
  color: var(--color-accent-hover);
}

.text-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  align-self: flex-start;
  width: 1.5rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-learner);
  cursor: pointer;
}

.icon-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.icon-mark {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

/* The level control: one word per step, the step drawn beside it. The level in
   force is graphite; the rest are written in blue. */
.level-edit {
  display: inline-flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.level-opt {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  cursor: pointer;
}

.level-opt:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.level-opt.active {
  color: var(--ink);
  font-weight: 700;
}

.level-opt:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.level-mark {
  flex: 0 0 auto;
  fill: none;
  stroke: var(--pencil);
  stroke-linecap: round;
}

.level-opt.active .level-mark {
  stroke: var(--ink);
}

.subtopic-list {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
}

.subtopic-row {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.st-name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
  overflow-wrap: anywhere;
}

/* A field on a rule, with the action written in blue beside it. */
.add-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  width: 100%;
  max-width: 24rem;
}

.add-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  border-radius: 0;
  background: transparent;
  color: var(--ink-learner);
  caret-color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}

.add-input::placeholder {
  color: var(--pencil);
}

.add-input:focus {
  outline: none;
  border-bottom-color: var(--ink-learner);
}

.summary-text {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
  white-space: pre-wrap;
  max-width: 72ch;
}

/* Check-questions as marked lines: the mark drawn in red pen, the gap in blue,
   the question in graphite and the date in pencil. No side bar, no fill. */
.event-list {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
}

.event-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
  box-shadow: inset 0 -1px 0 var(--rule);
}

.event-row + .event-row {
  padding-top: 0.75rem;
}

.event-mark {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: 1.75rem;
}

.event-mark-draw {
  fill: none;
  stroke: var(--ink-marker);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.event-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.event-gap {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink-learner);
  overflow-wrap: anywhere;
}

.event-q {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.event-when {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink-marker-text);
}

/* A status caption: one line of ink on paper inside a full rule; the alert
   edge is red pen. */
.conflict {
  align-self: flex-start;
  margin: 1.75rem 0 0;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--ink-marker);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--ink);
}

/* Skeleton: pencil-weight rules on the pitch, no shimmer. */
.skel {
  display: flex;
  flex-direction: column;
  padding-top: 1.75rem;
}

.skel-block {
  display: block;
  height: 1.75rem;
  border-bottom: 1px solid var(--rule-strong);
}

.skel-short {
  width: 55%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

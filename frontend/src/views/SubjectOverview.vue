<template>
  <section data-testid="subject-overview" class="overview">
    <template v-if="subject">
      <header class="overview-header">
        <h1 class="overview-title">{{ subject.title }}</h1>
        <div
          role="progressbar"
          data-testid="subject-progress-bar"
          aria-valuemin="0"
          :aria-valuenow="subject.progress?.done_count"
          :aria-valuemax="subject.progress?.total_count"
          class="progress-track"
        >
          <div class="progress-fill" :style="{ width: progressPct + '%' }" />
        </div>
      </header>

      <p data-testid="subject-meta" class="subject-meta">{{ meta }}</p>

      <div class="lesson-list-controls">
        <button
          type="button"
          data-testid="overview-edit-toggle"
          :class="['edit-toggle-btn', { 'edit-toggle-btn--active': editMode }]"
          @click="toggleEditMode"
        >
          {{ editMode ? 'Done editing' : 'Edit plan' }}
        </button>
      </div>

      <ul class="lesson-list">
        <template v-for="(lesson, idx) in lessons" :key="lesson.id">
          <li
            :data-testid="lesson.id === nextId ? 'subject-lesson-next' : undefined"
            :class="['lesson-row', { 'lesson-row--next': lesson.id === nextId }]"
          >
            <!-- Open lesson button — always accessible in both view and edit modes -->
            <button
              :data-testid="`subject-lesson-${lesson.id}`"
              type="button"
              class="lesson-btn"
              @click="goToLesson(lesson.id)"
            >
              <span
                :data-testid="`subject-lesson-status-${lesson.id}`"
                :class="['lesson-status', `lesson-status--${lesson.status}`]"
              >
                {{ STATUS_LABEL[lesson.status] || lesson.status }}
              </span>
              <span class="lesson-title">{{ lesson.title }}</span>
            </button>

            <!-- Edit controls: visible only when edit mode is active -->
            <div v-if="editMode" class="lesson-edit-bar">
              <!-- Inline edit form for title and goal -->
              <div v-if="editingLessonId === lesson.id" class="lesson-inline-edit">
                <input
                  v-model="editTitleInput"
                  type="text"
                  class="edit-input"
                  aria-label="Lesson title"
                  @keydown.escape="editingLessonId = null"
                />
                <input
                  v-model="editGoalInput"
                  type="text"
                  class="edit-input"
                  aria-label="Lesson goal"
                  @keydown.escape="editingLessonId = null"
                />
                <button type="button" class="edit-action-btn" @click="saveEdit(lesson.id)">Save</button>
                <button type="button" class="edit-action-btn edit-action-btn--ghost" @click="editingLessonId = null">Cancel</button>
              </div>
              <!-- Per-lesson action buttons -->
              <div v-else class="lesson-edit-actions">
                <button type="button" class="edit-action-btn" @click="startEdit(lesson)">Rename</button>
                <button
                  type="button"
                  class="reorder-btn"
                  :disabled="idx === 0"
                  aria-label="Move up"
                  @click="store.moveLesson(lesson.id, idx - 1)"
                >
                  <i class="pi pi-angle-up" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="reorder-btn"
                  :disabled="idx === lessons.length - 1"
                  aria-label="Move down"
                  @click="store.moveLesson(lesson.id, idx + 1)"
                >
                  <i class="pi pi-angle-down" aria-hidden="true" />
                </button>
                <button type="button" class="edit-action-btn" @click="openAddAfter(idx)">+ Add here</button>
                <button
                  type="button"
                  data-testid="overview-delete-lesson"
                  class="edit-action-btn edit-action-btn--danger"
                  :aria-label="`Delete ${lesson.title}`"
                  @click="handleDeleteLesson(lesson)"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>

          <!-- Add lesson form — renders inline after the lesson at addingAfterIdx -->
          <li v-if="editMode && addingAfterIdx === idx" class="lesson-add-row">
            <form
              data-testid="overview-add-lesson"
              class="add-lesson-form"
              @submit.prevent="submitAdd(idx)"
            >
              <input
                v-model="addTitle"
                type="text"
                class="edit-input"
                placeholder="Lesson title"
                required
                aria-label="New lesson title"
              />
              <input
                v-model="addGoal"
                type="text"
                class="edit-input"
                placeholder="Goal (optional)"
                aria-label="New lesson goal"
              />
              <div class="add-lesson-actions">
                <button type="submit" class="edit-action-btn">Add lesson</button>
                <button type="button" class="edit-action-btn edit-action-btn--ghost" @click="addingAfterIdx = null">Cancel</button>
              </div>
            </form>
          </li>
        </template>
      </ul>

      <button
        v-if="nextId"
        type="button"
        data-testid="subject-open-next"
        class="open-next-btn"
        @click="openNext"
      >
        Open next lesson
      </button>

      <router-link
        :to="{ name: 'subject-mastery', params: { id: props.id } }"
        class="mastery-link"
        data-testid="overview-mastery-link"
      >
        View mastery map
      </router-link>

      <div
        v-if="duplicateCount > 0"
        class="dupe-banner"
        data-testid="subject-dupe-banner"
      >
        <div class="dupe-text">
          <i class="pi pi-exclamation-triangle dupe-icon" aria-hidden="true" />
          <p class="dupe-line">
            {{ duplicateCount }} duplicate {{ duplicateCount === 1 ? 'session' : 'sessions' }} detected.
            Keep the first per topic, end the rest?
          </p>
        </div>
        <button
          type="button"
          class="dupe-btn"
          :disabled="cleaning"
          data-testid="subject-dupe-cleanup"
          @click="cleanupDuplicates"
        >
          <span>{{ cleaning ? 'Cleaning...' : 'Clean up' }}</span>
          <i class="pi pi-broom" aria-hidden="true" />
        </button>
      </div>
    </template>

    <div
      v-else
      data-testid="subject-overview-loading"
      class="overview-loading"
      aria-busy="true"
      aria-label="Loading subject"
    >
      <div class="skeleton skeleton-title" />
      <div class="skeleton skeleton-bar" />
      <div class="skeleton skeleton-row" />
      <div class="skeleton skeleton-row" />
      <div class="skeleton skeleton-row" />
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'

import { useSessionStore } from '../stores/session.js'
import { useSubjectStore } from '../stores/subject.js'
import { normalizeTopicKey } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })
const router = useRouter()
const store = useSubjectStore()
const sessionStore = useSessionStore()
const confirm = useConfirm()

onMounted(() => {
  store.loadSubject(props.id).catch(() => {})
  sessionStore.listSessions().catch(() => {})
})

const subject = computed(() => store.currentSubject)
const lessons = computed(() => subject.value?.lessons || [])
const nextId = computed(() => store.nextLesson?.id || null)

// Progress percentage for visual fill (0-100)
const progressPct = computed(() => {
  const s = subject.value
  if (!s?.progress?.total_count) return 0
  return Math.round((s.progress.done_count / s.progress.total_count) * 100)
})

// Duration meta is display-only: the backend returns duration_mode + BOTH
// pinned and derived knobs, so render them — never recompute here.
const meta = computed(() => {
  const s = subject.value
  if (!s) return ''
  const min = `per session ~${s.per_session_minutes} min`
  const weeks = Math.round((s.timeline_days || 0) / 7)
  const pace = `~${s.pace_per_week}/week`
  return s.duration_mode === 'pace'
    ? `${min} · ${pace} · ~${weeks} weeks`    // pinned pace, derived horizon
    : `${min} · ${weeks}-week plan · ${pace}` // pinned timeline, derived pace
})

const STATUS_LABEL = {
  done: 'done',
  in_progress: 'in progress',
  not_started: 'not started',
}

async function goToLesson(lessonId) {
  const sid = await store.openLesson(lessonId)
  if (sid) router.push({ name: 'session', params: { id: sid } })
}

function openNext() {
  if (nextId.value) goToLesson(nextId.value)
}

// Dupe-banner: active opened lessons sharing a normalized title.
// "Active" = session_id is set AND the linked session has no ended_at.
// Cross-references sessionStore.sessions so ending a duplicate session
// drops it from the active set and clears the banner once all are resolved.
// Scoped to this subject; sorts by order_idx (ascending) — keeps first, ends rest.
const duplicateSessionIds = computed(() => {
  // Build lookup: session_id -> ended_at (undefined for sessions not in list = treated as active)
  const endedAt = new Map(sessionStore.sessions.map((s) => [s.id, s.ended_at]))

  // Only consider opened lessons whose linked session is NOT ended
  const active = lessons.value.filter(
    (l) => l.session_id && !endedAt.get(l.session_id),
  )

  const byTopic = new Map()
  for (const l of active) {
    const key = normalizeTopicKey(l.title)
    const list = byTopic.get(key) || []
    list.push(l)
    byTopic.set(key, list)
  }
  const dupes = []
  for (const list of byTopic.values()) {
    if (list.length <= 1) continue
    list.sort((a, b) => a.order_idx - b.order_idx)
    for (let i = 1; i < list.length; i++) dupes.push(list[i].session_id)
  }
  return dupes
})

const duplicateCount = computed(() => duplicateSessionIds.value.length)
const cleaning = ref(false)

async function cleanupDuplicates() {
  const ids = duplicateSessionIds.value
  if (!ids.length) return
  cleaning.value = true
  try {
    await Promise.all(ids.map((id) => sessionStore.endSession(id)))
    await Promise.all([store.loadSubject(props.id), sessionStore.listSessions()])
  } catch {
    // surface nothing — banner will update if reload succeeds
  } finally {
    cleaning.value = false
  }
}

// --- Lesson delete ---
async function handleDeleteLesson(lesson) {
  if (lesson.session_id == null) {
    try {
      await store.removeLesson(lesson.id)
    } catch {
      // removeLesson re-throws on API failure; the store captured the error
      // state. Swallow here so a failed delete is not an unhandled rejection.
    }
  } else {
    confirm.require({
      message: "End this lesson's chat and remove it? This ends the session and deletes the lesson.",
      header: 'End & delete lesson',
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Cancel',
      acceptLabel: 'End & delete',
      rejectClass: 'p-button-text p-button-secondary',
      acceptClass: 'p-button-danger confirm-delete-strong',
      acceptProps: { 'data-testid': 'overview-delete-force' },
      accept: async () => {
        await store.removeLesson(lesson.id, { force: true })
      },
    })
  }
}

// --- Plan revision edit mode ---
const editMode = ref(false)
const addingAfterIdx = ref(null)
const addTitle = ref('')
const addGoal = ref('')
const editingLessonId = ref(null)
const editTitleInput = ref('')
const editGoalInput = ref('')

function toggleEditMode() {
  editMode.value = !editMode.value
  addingAfterIdx.value = null
  editingLessonId.value = null
}

function startEdit(lesson) {
  editingLessonId.value = lesson.id
  editTitleInput.value = lesson.title
  editGoalInput.value = lesson.goal || ''
}

async function saveEdit(lessonId) {
  const title = editTitleInput.value.trim()
  const goal = editGoalInput.value.trim()
  if (title) await store.renameLesson(lessonId, title)
  const lesson = lessons.value.find((l) => l.id === lessonId)
  if (goal !== (lesson?.goal || '')) await store.editLessonGoal(lessonId, goal)
  editingLessonId.value = null
}

function openAddAfter(idx) {
  addingAfterIdx.value = idx
  addTitle.value = ''
  addGoal.value = ''
}

async function submitAdd(afterIdx) {
  const title = addTitle.value.trim()
  if (!title) return
  await store.addLessonAfter(props.id, afterIdx, { title, goal: addGoal.value.trim() })
  addingAfterIdx.value = null
  addTitle.value = ''
  addGoal.value = ''
}
</script>

<style scoped>
.overview {
  max-width: 56rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
}

.overview-header {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Loading skeleton: shown while the subject overview is in flight so the route
   paints structure immediately instead of a blank flash. */
.overview-loading {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.skeleton {
  background: var(--color-surface);
  border-radius: var(--radius-card);
  animation: overview-pulse 1.2s ease-in-out infinite;
}

.skeleton-title { height: 1.75rem; width: 14rem; }
.skeleton-bar { height: 6px; width: 100%; border-radius: 3px; }
.skeleton-row { height: 3rem; width: 100%; }

@keyframes overview-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}

.overview-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
}

.progress-track {
  height: 6px;
  background: var(--color-border);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.subject-meta {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin: 0;
}

.lesson-list-controls {
  display: flex;
  justify-content: flex-end;
}

.edit-toggle-btn {
  padding: 0.4rem 0.9rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  color: var(--color-accent);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.edit-toggle-btn--active {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  border-color: var(--color-accent);
}

.lesson-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lesson-row {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
}

.lesson-row--next {
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
}

.lesson-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font-size: inherit;
}

.lesson-status {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.lesson-status--done {
  color: var(--signal-success);
}

.lesson-title {
  flex: 1;
}

.lesson-edit-bar {
  border-top: 1px solid var(--color-border);
  padding: 0.5rem 1rem;
}

.lesson-inline-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.lesson-edit-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.edit-input {
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  color: inherit;
  font-size: 0.875rem;
  flex: 1;
  min-width: 8rem;
}

.edit-input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.edit-action-btn {
  padding: 0.375rem 0.75rem;
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  border: none;
  border-radius: var(--radius-card);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.edit-action-btn--ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: inherit;
}

.edit-action-btn--danger {
  background: transparent;
  border: 1px solid var(--signal-error);
  color: var(--signal-error);
}

.reorder-btn {
  padding: 0.375rem 0.5rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  color: inherit;
  cursor: pointer;
  font-size: 0.875rem;
  line-height: 1;
}

.reorder-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.lesson-add-row {
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-card);
  list-style: none;
}

.add-lesson-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  align-items: center;
}

.add-lesson-actions {
  display: flex;
  gap: 0.5rem;
}

.open-next-btn {
  align-self: flex-start;
  padding: 0.6rem 1.25rem;
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  border: none;
  border-radius: var(--radius-card);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.mastery-link {
  align-self: flex-start;
  font-size: 0.875rem;
  color: var(--color-accent);
  text-decoration: none;
}

.mastery-link:hover {
  text-decoration: underline;
}

.dupe-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
}

.dupe-text {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.dupe-icon {
  color: var(--color-accent);
  flex-shrink: 0;
}

.dupe-line {
  margin: 0;
  font-size: 0.875rem;
}

.dupe-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.9rem;
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  border: none;
  border-radius: var(--radius-card);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.dupe-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

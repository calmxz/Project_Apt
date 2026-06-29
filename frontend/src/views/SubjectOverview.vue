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

      <ul class="lesson-list">
        <li
          v-for="lesson in lessons"
          :key="lesson.id"
          :data-testid="lesson.id === nextId ? 'subject-lesson-next' : undefined"
          :class="['lesson-row', { 'lesson-row--next': lesson.id === nextId }]"
        >
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
        </li>
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
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useSessionStore } from '../stores/session.js'
import { useSubjectStore } from '../stores/subject.js'
import { normalizeTopicKey } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })
const router = useRouter()
const store = useSubjectStore()
const sessionStore = useSessionStore()

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

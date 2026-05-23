<template>
  <section class="sprof" data-testid="session-profile">
    <BackButton label="Back to session" :fallback="`/session/${id}`" />

    <header class="head">
      <div class="head-text">
        <span class="folio">session profile</span>
        <h1 class="title">{{ topicLabel }}</h1>
        <p v-if="data?.profile?.knowledge_level" class="lede">
          Working at the
          <span class="level-pill" :data-level="data.profile.knowledge_level">{{ data.profile.knowledge_level }}</span>
          level.
        </p>
      </div>
    </header>

    <p v-if="loading" class="muted" data-testid="sprof-loading">Loading...</p>
    <p v-else-if="error" class="error" data-testid="sprof-error">{{ error }}</p>

    <template v-else-if="data">
      <div
        v-if="data.profile.focus_target_gap"
        class="focus"
        data-testid="sprof-focus"
      >
        <span class="focus-icon" aria-hidden="true">
          <i class="pi pi-bullseye" />
        </span>
        <div class="focus-body">
          <span class="focus-label">Current focus</span>
          <span class="focus-gap">{{ data.profile.focus_target_gap }}</span>
        </div>
      </div>

      <div class="two-col">
        <div class="col" data-testid="sprof-mastered">
          <h2 class="section-title">
            <i class="pi pi-check-circle col-icon col-icon-green" aria-hidden="true" />
            Mastered
          </h2>
          <p v-if="!data.profile.mastered_concepts?.length" class="muted">
            Nothing recorded yet.
          </p>
          <ul v-else class="chip-list">
            <li
              v-for="c in data.profile.mastered_concepts"
              :key="`m-${c}`"
              class="chip chip-mastered"
            >
              {{ c }}
            </li>
          </ul>
        </div>

        <div class="col" data-testid="sprof-gaps">
          <h2 class="section-title">
            <i class="pi pi-bolt col-icon col-icon-yellow" aria-hidden="true" />
            Confirmed gaps
          </h2>
          <p v-if="!data.profile.confirmed_gaps?.length" class="muted">
            None.
          </p>
          <ul v-else class="chip-list">
            <li
              v-for="g in data.profile.confirmed_gaps"
              :key="`g-${g}`"
              class="chip chip-gap"
            >
              {{ g }}
            </li>
          </ul>
        </div>
      </div>

      <div v-if="data.profile.last_session_summary" class="summary" data-testid="sprof-summary">
        <h2 class="section-title">Session summary</h2>
        <div class="summary-card">
          <p class="summary-text">{{ data.profile.last_session_summary }}</p>
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

import BackButton from '../components/BackButton.vue'
import { friendlyError } from '../lib/errors.js'
import { getSessionProfile } from '../services/profileApi.js'
import { useSessionStore } from '../stores/session.js'
import { formatRelative } from '../utils/formatDate.js'

const props = defineProps({ id: { type: String, required: true } })

const store = useSessionStore()
const data = ref(null)
const loading = ref(false)
const error = ref('')

const topicLabel = computed(() => {
  const fromStore = store.sessions.find((s) => s.id === props.id)?.topic
  return fromStore || store.currentSession?.topic || 'Session profile'
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getSessionProfile(props.id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.sprof {
  max-width: 56rem;
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
  color: var(--color-accent);
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
  color: var(--signal-info);
  border-color: rgba(91, 141, 239, 0.3);
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
  color: var(--signal-success);
  border-color: rgba(34, 197, 94, 0.3);
}

.level-pill[data-level='unknown'] {
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

.muted { color: var(--color-text-muted); }
.error { color: var(--signal-error); }

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
  background: var(--color-accent);
  color: #FFFFFF;
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
:root[data-theme='dark'] .focus-label { color: var(--accent-coral-300); }

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

.col-icon { font-size: 1.05rem; }
.col-icon-green { color: var(--signal-success); }
.col-icon-yellow { color: var(--signal-warning); }

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

.chip:hover { transform: translateY(-1px); }

.chip-mastered {
  background: rgba(34, 197, 94, 0.14);
  color: var(--signal-success);
  border-color: rgba(34, 197, 94, 0.3);
}

.chip-gap {
  background: rgba(255, 176, 32, 0.16);
  color: #B5800F;
  border-color: rgba(255, 176, 32, 0.35);
}
:root[data-theme='dark'] .chip-gap { color: var(--signal-warning); }

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

.event-row:hover { transform: translateY(-1px); }

.evt-ok { border-left: 3px solid var(--signal-success); }
.evt-bad { border-left: 3px solid var(--signal-warning); }

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
  color: #FFFFFF;
}

.evt-ok .event-mark { background: var(--signal-success); }
.evt-bad .event-mark { background: var(--signal-warning); color: #2A1F00; }

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
</style>

<template>
  <section class="sprof" data-testid="session-profile">
    <BackButton :label="`Back to session`" :fallback="`/session/${id}`" />

    <header class="head">
      <div class="head-text">
        <span class="folio">session profile</span>
        <h1 class="title">{{ topicLabel }}</h1>
        <p class="lede" v-if="data?.profile?.knowledge_level">
          Working at the
          <span class="pill">{{ data.profile.knowledge_level }}</span>
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
        <span class="focus-label">Current focus</span>
        <span class="focus-gap">{{ data.profile.focus_target_gap }}</span>
      </div>

      <div class="two-col">
        <div class="col" data-testid="sprof-mastered">
          <h2 class="section-title">Mastered</h2>
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
          <h2 class="section-title">Confirmed gaps</h2>
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
        <p class="summary-text">{{ data.profile.last_session_summary }}</p>
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
              <span class="event-mark" aria-hidden="true">
                {{ ev.correct ? '+' : '×' }}
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
  gap: 1.75rem;
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.folio {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
}

.title {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 400;
  font-variation-settings: 'opsz' 144;
  letter-spacing: var(--tracking-display);
  line-height: 1.1;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
}

.pill {
  display: inline-block;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--color-border-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  text-transform: lowercase;
  color: var(--color-heading);
}

.muted { color: var(--color-text-muted); }
.error { color: var(--signal-error); }

.focus {
  display: inline-flex;
  align-items: baseline;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  border-radius: var(--radius-md);
  align-self: flex-start;
}

.focus-label {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-accent);
}

.focus-gap {
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  color: var(--color-heading);
}

.section-title {
  font-family: var(--font-serif);
  font-size: 1.25rem;
  font-weight: 400;
  letter-spacing: var(--tracking-display);
  color: var(--color-heading);
  margin: 0 0 0.75rem 0;
}

.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 2rem;
}

.chip-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  padding: 0.3rem 0.625rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
}

.chip-mastered { color: var(--color-heading); }
.chip-gap { color: var(--signal-error); }

.summary-text {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

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
  gap: 0.25rem;
  padding: 0.625rem 0.875rem;
  border-left: 2px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.evt-ok { border-left-color: var(--signal-success, #6b7d4e); }
.evt-bad { border-left-color: var(--signal-error); }

.event-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.event-gap {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
}

.event-mark {
  font-family: var(--font-mono);
  font-size: 1rem;
  color: var(--color-heading);
}

.event-q {
  margin: 0;
  font-family: var(--font-serif);
  color: var(--color-heading);
}

.event-when {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
}
</style>

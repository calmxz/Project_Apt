<template>
  <section class="home">
    <h1 class="home-head">What do you want to learn?</h1>

    <p v-if="store.error && !store.sessions.length" class="error" data-testid="home-error">
      {{ friendlyError(store.error) }}
    </p>

    <template v-else>
      <div class="quick" data-testid="home-mode-quick">
        <label for="home-topic" class="sr-only">Topic</label>
        <input
          id="home-topic"
          v-model="quickTopic"
          class="quick-input"
          data-testid="home-quick-topic"
          placeholder="a topic, a chapter, a thing that will not stick..."
          autocomplete="off"
          @keydown.enter="startQuick"
        />

        <p class="quick-picks" role="group" aria-label="Quick topic ideas">
          <button
            v-for="pick in quickPicks"
            :key="pick"
            type="button"
            class="quick-pick"
            @click="quickTopic = pick"
          >
            {{ pick }}
          </button>
        </p>

        <p class="quick-go">
          <button
            type="button"
            class="cta-primary"
            data-testid="home-quick-go"
            :disabled="busy"
            @click="startQuick"
          >
            <span>{{ startLabel }}</span>
            <svg
              class="cta-mark"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 10 L15 10 M10.5 5.5 L15 10 L10.5 14.5" />
            </svg>
          </button>
        </p>
      </div>
      <StartTopicIntercept
        v-if="stage === 'intercept'"
        :match="interceptMatch"
        :kind="interceptKind"
        :busy="busy"
        @open-existing="openExisting"
        @continue-topic="continuePrior"
        @start-fresh="startFresh"
        @cancel="cancel"
      />

      <section v-if="recent.length" class="recent" data-testid="home-recent">
        <h2 class="recent-head">Recent</h2>
        <ul class="recent-list">
          <li
            v-for="s in recent"
            :key="s.id"
            class="recent-row"
            :class="{ 'recent-row--ended': !!s.ended_at }"
            :data-testid="`home-recent-${s.id}`"
          >
            <RouterLink
              class="recent-link"
              :to="{ name: 'session', params: { id: s.id } }"
              :aria-label="recentLabel(s)"
            >
              <span class="recent-label">
                <span class="recent-topic">{{ s.topic || 'Untitled' }}</span>
                <span v-if="masteredOf(s)" class="recent-mastered" data-tabular aria-hidden="true">
                  <svg
                    class="recent-mark recent-mark--tick"
                    viewBox="0 0 12 12"
                    width="10"
                    height="10"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M2 6.5 L4.8 9.2 L10 3.2" />
                  </svg>
                  {{ masteredOf(s) }}
                </span>
              </span>
              <span v-if="focusOf(s)" class="recent-focus" aria-hidden="true">{{
                focusOf(s)
              }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import StartTopicIntercept from '../components/start/StartTopicIntercept.vue'
import { useStartFlow } from '../composables/useStartFlow.js'
import { useSessionStore } from '../stores/session.js'
import { friendlyError } from '../lib/errors.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')

const RECENT_LIMIT = 5

const quickPicks = [
  'Recursion',
  'CSS grid',
  'Photosynthesis',
  'Big-O notation',
  'French verbs',
  'World War II',
]

const {
  stage,
  busy,
  interceptMatch,
  interceptKind,
  begin,
  openExisting,
  continuePrior,
  startFresh,
  cancel,
} = useStartFlow({ store, router })

watch(quickTopic, () => cancel())

const startLabel = computed(() => (busy.value ? 'Starting...' : 'Start'))

// The contents rows under the prompt. SessionListItem.progress carries only
// focus_target_gap and mastered_count, so a row reads: topic, mastered count,
// focus cue underneath -- the same three-cell label the sidebar uses, minus
// the level cell the API does not serve here.
const recent = computed(() => (store.sessions || []).slice(0, RECENT_LIMIT))

function masteredOf(s) {
  return s?.progress?.mastered_count || 0
}

function focusOf(s) {
  return s?.progress?.focus_target_gap || ''
}

function recentLabel(s) {
  const parts = [`Open session: ${s.topic || 'Untitled'}`]
  if (focusOf(s)) parts.push(`focus ${focusOf(s)}`)
  if (masteredOf(s)) parts.push(`${masteredOf(s)} mastered`)
  return parts.join(', ')
}

onMounted(() => {
  // U-05: boot-path load - failure is handled locally (store error state), so
  // a transient backend hiccup must not toast on Home's first mount. Silence
  // comes from { silent: true } on the getSessionLibrary calls inside
  // store.listSessions() (session.js), not from sessionsApi.listSessions.
  store.listSessions().catch(() => {})
})

function startQuick() {
  begin(quickTopic.value)
}
</script>

<style scoped>
/* A fresh sheet: the question is the one display line, the topic is written on
   the rule under it, and what you studied before sits below as contents rows. */
.home {
  max-width: 44rem;
  margin: 0 auto;
  padding-top: var(--line-pitch);
  display: flex;
  flex-direction: column;
  gap: var(--line-pitch);
}

.home-head {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-marker-text);
}

.quick {
  display: flex;
  flex-direction: column;
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

/* Field on a rule: no box, no radius, one bottom rule that inks on focus. */
.quick-input {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--rule-strong);
  border-radius: 0;
  background: transparent;
  color: var(--ink-learner);
  caret-color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: calc(var(--line-pitch) - 1px);
}

.quick-input::placeholder {
  color: var(--pencil);
}

.quick-input:focus {
  outline: none;
  border-bottom-color: var(--ink-learner);
}

/* Quick picks are cue words on the next rule, not chips. */
.quick-picks {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.25rem;
  margin: 0;
  line-height: var(--line-pitch);
}

.quick-pick {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  cursor: pointer;
}

.quick-pick:hover {
  color: var(--color-accent-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.quick-pick:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.quick-go {
  margin: 0;
  padding-top: var(--line-pitch);
  line-height: var(--line-pitch);
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--color-accent-strong);
  color: var(--color-text-on-accent);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 600;
  line-height: var(--line-pitch);
  cursor: pointer;
}

.cta-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.cta-primary:disabled {
  background: transparent;
  color: var(--pencil);
  cursor: default;
}

.cta-mark {
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cta-primary:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* Contents rows on the ruled ground. */
.recent-head {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background-image: var(--ruled-bg);
  background-position-y: var(--ruled-offset);
  background-attachment: local;
}

.recent-row {
  margin: 0;
}

.recent-row:hover {
  background: var(--color-surface-soft);
}

.recent-link {
  display: flex;
  flex-direction: column;
  min-height: var(--line-pitch);
  padding: 0 0.25rem 0 0.75rem;
  color: var(--ink);
  text-decoration: none;
}

.recent-link:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: -2px;
}

.recent-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  line-height: var(--line-pitch);
}

.recent-topic {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-row--ended .recent-topic {
  color: var(--pencil);
}

.recent-mastered {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  color: var(--pencil);
}

.recent-mark {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.recent-mark--tick {
  stroke: var(--ink-learner);
}

/* Line two: the focus cue in ink, marked in red, never set in red. */
.recent-focus {
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

@media (max-width: 599px) {
  .quick-picks {
    gap: 0 1rem;
  }
}
</style>

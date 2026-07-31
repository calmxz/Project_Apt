<template>
  <section class="home">
    <h1 class="title">What do you want to learn?</h1>

    <p v-if="store.loading" class="muted">Loading...</p>
    <p v-else-if="store.error && !store.sessions.length" class="error" data-testid="home-error">
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
          placeholder="e.g. Recursion, the Krebs cycle, French passe compose..."
          autocomplete="off"
          @keydown.enter="startQuick"
        />
        <button
          type="button"
          class="cta-primary"
          data-testid="home-quick-go"
          :disabled="busy"
          @click="startQuick"
        >
          <span>Start</span><i class="pi pi-arrow-right" aria-hidden="true" />
        </button>
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
      <StartLevelPicker
        v-else-if="stage === 'level'"
        :busy="busy"
        @select="pickLevel"
        @quiz="pickQuiz"
        @skip="skipLevel"
      />
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import StartLevelPicker from '../components/start/StartLevelPicker.vue'
import StartTopicIntercept from '../components/start/StartTopicIntercept.vue'
import { useStartFlow } from '../composables/useStartFlow.js'
import { useSessionStore } from '../stores/session.js'
import { friendlyError } from '../lib/errors.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')

const {
  stage,
  busy,
  interceptMatch,
  interceptKind,
  begin,
  openExisting,
  continuePrior,
  startFresh,
  pickLevel,
  pickQuiz,
  skipLevel,
  cancel,
} = useStartFlow({ store, router })

watch(quickTopic, () => cancel())

onMounted(() => {
  // U-05: boot-path load - failure is handled locally (store error state),
  // so a transient backend hiccup must not toast on Home's very first mount.
  // Silence is threaded through explicitly via { silent: true } on the
  // getSessionLibrary calls inside listSessions() (session.js), not by any
  // unconditional silence in the (unused) sessionsApi.listSessions export.
  store.listSessions().catch(() => {})
})

function startQuick() {
  begin(quickTopic.value)
}
</script>

<style scoped>
.home {
  max-width: 42rem;
  margin: 3rem auto 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  text-align: center;
  margin: 0;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--color-error-text);
}

.quick {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
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

.quick-input {
  display: block;
  width: 100%;
  padding: 1.125rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-heading);
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: var(--tracking-tight);
  box-shadow: var(--shadow-paper);
  transition: border-color var(--motion-fast) ease;
}

.quick-input::placeholder {
  color: var(--color-text-faint);
  font-weight: 400;
}

.quick-input:hover {
  border-color: var(--color-border-strong);
}

.quick-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.625rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #ffffff;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  transition:
    filter var(--motion-fast) ease,
    opacity var(--motion-fast) ease;
}

.cta-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.cta-primary:active:not(:disabled) {
  filter: brightness(0.95);
}

.cta-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cta-primary:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}
</style>

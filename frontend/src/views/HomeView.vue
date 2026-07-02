<template>
  <section class="home">
    <h1 class="title">What do you want to learn?</h1>

    <p v-if="store.loading" class="muted">Loading...</p>
    <p
      v-else-if="store.error"
      class="error"
      data-testid="home-error"
    >
      {{ friendlyError(store.error) }}
    </p>

    <template v-else>
      <div class="modes">
        <div class="mode-card" data-testid="home-mode-quick">
          <h2 class="mode-title">New lesson</h2>
          <p class="mode-sub">One topic. Type and go.</p>
          <input
            v-model="quickTopic"
            class="quick-input"
            data-testid="home-quick-topic"
            placeholder="e.g. Recursion"
            @keydown.enter="startQuick"
          />
          <button
            type="button"
            class="cta-primary"
            data-testid="home-quick-go"
            @click="startQuick"
          >
            <span>Start</span><i class="pi pi-arrow-right" aria-hidden="true" />
          </button>
          <RouterLink to="/new" class="quick-more">Add reference files</RouterLink>
        </div>
      </div>

      <RouterLink
        v-if="resumeSession"
        class="resume"
        data-testid="home-resume"
        :to="{ name: 'session', params: { id: resumeSession.id } }"
      >
        <span>Continue where you left off — {{ resumeSession.topic || 'untitled' }}</span>
      </RouterLink>
      <button
        v-if="resumeSession"
        type="button"
        class="resume-btn"
        data-testid="home-resume-continue"
        @click="continueResume"
      >
        Continue
      </button>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session.js'
import { friendlyError } from '../lib/errors.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')

onMounted(() => store.listSessions().catch(() => {}))

const resumeSession = computed(() => {
  const active = store.sessions.filter((s) => !s.ended_at)
  if (!active.length) return null
  return [...active].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
})

async function startQuick() {
  const topic = quickTopic.value.trim()
  if (!topic) return
  const created = await store.createSession({ topic, seedMode: 'fresh', priorSessionId: null })
  if (created) router.push({ name: 'session', params: { id: created.id } })
}

function continueResume() {
  if (resumeSession.value) router.push({ name: 'session', params: { id: resumeSession.value.id } })
}
</script>

<style scoped>
.home {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--color-error-text);
}

/* Mode cards */
.modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 1rem;
}

.mode-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-pop);
}

.mode-title {
  font-family: var(--font-display);
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
}

.mode-sub {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.quick-input {
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 1rem;
  transition: border-color var(--motion-fast) ease;
}

.quick-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.quick-input::placeholder {
  color: var(--color-text-muted);
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.375rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce), box-shadow var(--motion-fast) ease;
}

.cta-primary:hover {
  transform: translateY(-2px);
}

.cta-primary:active {
  transform: translateY(4px);
  box-shadow: var(--shadow-pop-pressed);
}

.cta-primary:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}

.quick-more {
  font-size: 0.9rem;
  color: var(--color-accent);
  text-decoration: none;
  transition: text-decoration var(--motion-fast) ease;
}

.quick-more:hover {
  text-decoration: underline;
}

.quick-more:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Resume nudge */
.resume {
  display: flex;
  align-items: center;
  padding: 1rem 1.25rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.resume:hover {
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}

.resume:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.resume span {
  font-size: 1rem;
  line-height: 1.4;
}

.resume-btn {
  align-self: flex-start;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent-soft);
  color: var(--color-accent-text);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.resume-btn:hover {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  transform: translateY(-1px);
}

.resume-btn:active {
  transform: translateY(2px);
}

.resume-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

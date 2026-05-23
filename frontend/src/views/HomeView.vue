<template>
  <section class="home">
    <header class="head">
      <div class="head-text">
        <span class="folio">your shelf</span>
        <h1 class="title">Sessions</h1>
        <p class="lede">
          <template v-if="activeSessions.length">
            {{ activeSessions.length }} active {{ activeSessions.length === 1 ? 'session' : 'sessions' }}. Pick up where you left off.
          </template>
          <template v-else>
            A study session is one conversation about one topic. Begin one.
          </template>
        </p>
      </div>
      <div class="head-cta">
        <router-link
          to="/profile"
          class="ghost-link"
          data-testid="home-profile-link"
          aria-label="View combined learning profile"
        >
          <i class="pi pi-user" aria-hidden="true" />
          <span>Combined profile</span>
        </router-link>
        <button
          type="button"
          class="cta-primary"
          data-testid="home-new-session"
          @click="goNew"
        >
          <span>New session</span>
          <i class="pi pi-plus" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="tabs" role="tablist" data-testid="home-tabs">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'active'"
        :class="['tab', { 'tab-active': tab === 'active' }]"
        data-testid="home-tab-active"
        @click="tab = 'active'"
      >
        <span class="tab-label">Active</span>
        <span class="tab-count">{{ activeSessions.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'ended'"
        :class="['tab', { 'tab-active': tab === 'ended' }]"
        data-testid="home-tab-ended"
        @click="tab = 'ended'"
      >
        <span class="tab-label">Ended</span>
        <span class="tab-count">{{ endedSessions.length }}</span>
      </button>
    </div>

    <p v-if="store.loading" class="muted">Loading...</p>
    <p v-else-if="store.error" class="error" data-testid="home-error">{{ store.error }}</p>

    <template v-else-if="tab === 'active'">
      <div
        v-if="duplicateCount > 0"
        class="dupe-banner"
        data-testid="home-dupe-banner"
      >
        <div class="dupe-text">
          <i class="pi pi-exclamation-triangle dupe-icon" aria-hidden="true" />
          <p class="dupe-line">
            {{ duplicateCount }} duplicate active {{ duplicateCount === 1 ? 'session' : 'sessions' }} detected.
            Keep the newest per topic, end the rest?
          </p>
        </div>
        <button
          type="button"
          class="dupe-btn"
          :disabled="cleaning"
          data-testid="home-dupe-cleanup"
          @click="cleanupDuplicates"
        >
          <span>{{ cleaning ? 'Cleaning…' : 'Clean up' }}</span>
          <i class="pi pi-broom" aria-hidden="true" />
        </button>
      </div>

      <EmptyState
        v-if="!activeSessions.length"
        data-testid="home-empty-active"
        tone="celebrate"
        eyebrow="page 01"
        headline="No active sessions"
      >
        <template #subtext>
          <template v-if="endedSessions.length">
            You have {{ endedSessions.length }} ended {{ endedSessions.length === 1 ? 'session' : 'sessions' }} in the
            <button type="button" class="inline-link" @click="tab = 'ended'">Ended</button> tab.
          </template>
          <template v-else>
            Start your first one — the tutor adapts as you go.
          </template>
        </template>
        <template #cta>
          <button type="button" class="cta-primary" @click="goNew">
            <span>Start your first session</span>
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </button>
        </template>
      </EmptyState>

      <div v-else class="tile-grid">
        <router-link
          v-for="s in activeSessions"
          :key="s.id"
          :to="{ name: 'session', params: { id: s.id } }"
          class="tile"
          :data-testid="`home-row-active-${s.id}`"
          :aria-label="rowLabel(s, 'active')"
        >
          <div class="tile-glyph" :style="{ background: tileTint(s.topic) }">
            <i :class="['pi', tileIcon(s.topic)]" aria-hidden="true" />
          </div>
          <div class="tile-body">
            <h3 class="tile-topic">{{ s.topic || 'Untitled' }}</h3>
            <p class="tile-meta">
              <span class="tile-id">#{{ shortId(s.id) }}</span>
              <span class="tile-dot">·</span>
              <span class="tile-when">started {{ formatRelative(s.created_at) }}</span>
            </p>
          </div>
          <i class="pi pi-arrow-right tile-arrow" aria-hidden="true" />
        </router-link>
      </div>
    </template>

    <template v-else>
      <EmptyState
        v-if="!endedSessions.length"
        data-testid="home-empty-ended"
        tone="pause"
        eyebrow="archive"
        headline="Nothing archived yet"
        subtext="When you end a session, it lands here."
      />

      <div v-else class="tile-grid tile-grid-ended">
        <div
          v-for="s in endedSessions"
          :key="s.id"
          class="tile tile-ended"
          :data-testid="`home-row-ended-${s.id}`"
        >
          <router-link
            :to="{ name: 'session', params: { id: s.id } }"
            class="tile-link"
            :aria-label="rowLabel(s, 'ended')"
          >
            <div class="tile-glyph tile-glyph-muted">
              <i :class="['pi', tileIcon(s.topic)]" aria-hidden="true" />
            </div>
            <div class="tile-body">
              <h3 class="tile-topic">{{ s.topic || 'Untitled' }}</h3>
              <p class="tile-meta">
                <span class="tile-id">#{{ shortId(s.id) }}</span>
                <span class="tile-dot">·</span>
                <span class="tile-when">ended {{ formatRelative(s.ended_at) }}</span>
              </p>
            </div>
          </router-link>
          <button
            type="button"
            class="tile-resume"
            :data-testid="`home-resume-${s.id}`"
            :disabled="!!resumingId"
            @click.stop="resume(s)"
          >
            <span>{{ resumingId === s.id ? 'Resuming…' : 'Resume' }}</span>
            <i class="pi pi-refresh" aria-hidden="true" />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import EmptyState from '../components/EmptyState.vue'

import * as sessionsApi from '../services/sessionsApi.js'
import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'
import {
  formatRelative,
  normalizeTopicKey,
  shortId,
} from '../utils/formatDate.js'

const router = useRouter()
const store = useSessionStore()
const user = useUserStore()

const tab = ref('active')
const resumingId = ref(null)
const cleaning = ref(false)

onMounted(async () => {
  if (user.userId) await store.listSessions(user.userId).catch(() => {})
})

const activeSessions = computed(() =>
  store.sessions.filter((s) => !s.ended_at),
)

const endedSessions = computed(() =>
  store.sessions.filter((s) => Boolean(s.ended_at)),
)

const duplicateActiveIds = computed(() => {
  const byTopic = new Map()
  for (const s of activeSessions.value) {
    const key = normalizeTopicKey(s.topic)
    const list = byTopic.get(key) || []
    list.push(s)
    byTopic.set(key, list)
  }
  const dupes = []
  for (const list of byTopic.values()) {
    if (list.length <= 1) continue
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    for (let i = 1; i < list.length; i++) dupes.push(list[i].id)
  }
  return dupes
})

const duplicateCount = computed(() => duplicateActiveIds.value.length)

function goNew() {
  router.push({ name: 'new-session' })
}

function rowLabel(data, status) {
  const when = data.ended_at || data.created_at
  return `Open ${status} session: ${data.topic || 'untitled'}, ${formatRelative(when)}`
}

// Map first character of topic to one of a small set of icon + tint pairs so
// every tile feels distinct without needing real subject classification.
const ICONS = ['pi-book', 'pi-bolt', 'pi-globe', 'pi-code', 'pi-palette', 'pi-compass', 'pi-microchip', 'pi-chart-line']
const TINTS = [
  'linear-gradient(135deg, #FFD9D2 0%, #FFB5A8 100%)',
  'linear-gradient(135deg, #DDE2EE 0%, #B7BFD2 100%)',
  'linear-gradient(135deg, #FFE4C4 0%, #FFD8A0 100%)',
  'linear-gradient(135deg, #D6F5E0 0%, #A3E2B8 100%)',
  'linear-gradient(135deg, #E0DDFF 0%, #C4BFFF 100%)',
  'linear-gradient(135deg, #FFE7F1 0%, #FFCCE4 100%)',
  'linear-gradient(135deg, #D4ECFF 0%, #A8D9FF 100%)',
  'linear-gradient(135deg, #FFF3C4 0%, #FFE49C 100%)',
]
function hashTopic(topic) {
  const t = String(topic || '').toLowerCase()
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0
  return Math.abs(h)
}
function tileIcon(topic) {
  return ICONS[hashTopic(topic) % ICONS.length]
}
function tileTint(topic) {
  return TINTS[hashTopic(topic) % TINTS.length]
}

async function resume(row) {
  resumingId.value = row.id
  try {
    await store.reopenSession(row.id, user.userId)
    router.push({ name: 'session', params: { id: row.id } })
  } catch {
    // store.error already populated
  } finally {
    resumingId.value = null
  }
}

async function cleanupDuplicates() {
  const ids = duplicateActiveIds.value
  if (!ids.length) return
  cleaning.value = true
  try {
    await Promise.all(ids.map((id) => sessionsApi.endSession(id, user.userId)))
    if (user.userId) await store.listSessions(user.userId)
  } catch (e) {
    store.setError(e?.message || 'Cleanup failed.')
  } finally {
    cleaning.value = false
  }
}
</script>

<style scoped>
.home {
  max-width: 64rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
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
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.lede {
  margin: 0;
  color: var(--color-text-muted);
  max-width: 32rem;
  font-size: 1.0625rem;
}

.head-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
}

.ghost-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 0.9375rem;
  text-decoration: none;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) ease;
}

.ghost-link:hover {
  color: var(--color-accent);
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
  transform: translateY(-1px);
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.375rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
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

/* Pill segmented tabs */
.tabs {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  width: max-content;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-text-muted);
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.tab:hover {
  color: var(--color-heading);
}

.tab-active {
  background: var(--color-accent);
  color: #FFFFFF;
  box-shadow: 0 2px 8px rgba(255, 107, 92, 0.3);
}

.tab-active:hover {
  color: #FFFFFF;
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 0.4rem;
  border-radius: var(--radius-pill);
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
}

.tab-active .tab-count {
  background: rgba(255, 255, 255, 0.22);
}

/* Tile grid */
.tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  gap: 1rem;
}

.tile {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.125rem 1.25rem;
  border-radius: var(--radius-card);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lift);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: transform var(--motion-base) var(--motion-bounce), box-shadow var(--motion-base) ease, border-color var(--motion-fast) ease;
}

.tile:hover {
  transform: translateY(-2px);
  border-color: var(--color-accent-soft);
}

.tile:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}

.tile-ended {
  align-items: stretch;
  flex-direction: column;
  padding: 0;
  cursor: default;
}

.tile-ended:hover {
  transform: none;
}

.tile-ended .tile-link {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.125rem 1.25rem 0.75rem;
  text-decoration: none;
  color: inherit;
  transition: transform var(--motion-fast) var(--motion-bounce);
}

.tile-ended .tile-link:hover {
  transform: translateY(-1px);
}

.tile-ended .tile-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
  border-radius: var(--radius-md);
}

.tile-glyph {
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-700);
  font-size: 1.375rem;
  box-shadow: inset 0 0 0 1px rgba(20, 24, 38, 0.06);
}

.tile-glyph-muted {
  background: var(--color-surface-soft) !important;
  color: var(--color-text-muted);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

.tile-body {
  flex: 1;
  min-width: 0;
}

.tile-topic {
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: var(--tracking-tight);
  color: var(--color-heading);
  margin: 0;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-meta {
  margin: 0.25rem 0 0;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.tile-id {
  font-family: var(--font-mono);
  color: var(--color-text-faint);
}

.tile-dot {
  color: var(--color-text-faint);
}

.tile-arrow {
  color: var(--color-text-faint);
  font-size: 1rem;
  transition: transform var(--motion-fast) var(--motion-bounce), color var(--motion-fast) ease;
}

.tile:hover .tile-arrow {
  color: var(--color-accent);
  transform: translateX(4px);
}

.tile-resume {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-end;
  margin: 0 1.25rem 1.125rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-accent);
  border: 1px solid var(--color-accent-soft);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.tile-resume:hover:not(:disabled) {
  background: var(--color-accent);
  color: #FFFFFF;
  transform: translateY(-1px);
}

.tile-resume:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.tile-resume:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.inline-link {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--color-accent);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  cursor: pointer;
}

.inline-link:hover {
  color: var(--color-accent-hover);
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error);
}

/* Duplicate banner */
.dupe-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem 0.875rem 1.125rem;
  background: rgba(255, 176, 32, 0.12);
  border: 1px solid rgba(255, 176, 32, 0.35);
  border-radius: var(--radius-lg);
  flex-wrap: wrap;
}

.dupe-text {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 14rem;
}

.dupe-icon {
  color: var(--signal-warning);
  font-size: 1.125rem;
}

.dupe-line {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.4;
}

.dupe-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-pill);
  background: var(--signal-warning);
  color: #2A1F00;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  transition: transform var(--motion-fast) var(--motion-bounce), filter var(--motion-fast) ease;
}

.dupe-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
}

.dupe-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

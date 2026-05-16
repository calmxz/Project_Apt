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
            A study session is a single conversation about a topic. Begin one.
          </template>
        </p>
      </div>
      <Button
        label="New session"
        icon="pi pi-plus"
        icon-pos="right"
        data-testid="home-new-session"
        class="cta"
        @click="goNew"
      />
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
        <p class="dupe-line">
          {{ duplicateCount }} duplicate active {{ duplicateCount === 1 ? 'session' : 'sessions' }} detected.
          Keep the newest per topic, end the rest?
        </p>
        <Button
          label="Clean up"
          icon="pi pi-broom"
          icon-pos="right"
          :loading="cleaning"
          data-testid="home-dupe-cleanup"
          class="dupe-btn"
          @click="cleanupDuplicates"
        />
      </div>

      <div v-if="!activeSessions.length" class="empty" data-testid="home-empty-active">
        <p class="empty-eyebrow">page 01</p>
        <p class="empty-line">No active sessions.</p>
        <p class="empty-sub">
          <template v-if="endedSessions.length">
            You have {{ endedSessions.length }} ended {{ endedSessions.length === 1 ? 'session' : 'sessions' }} in the
            <button type="button" class="inline-link" @click="tab = 'ended'">Ended</button> tab.
          </template>
          <template v-else>
            Start your first one — the tutor will adapt as you go.
          </template>
        </p>
      </div>

      <DataTable
        v-else
        :value="activeSessions"
        data-testid="home-sessions"
        class="table"
        :row-class="() => 'session-row'"
        @row-click="onRowClick"
      >
        <Column field="topic" header="Topic">
          <template #body="{ data }">
            <router-link
              :to="{ name: 'session', params: { id: data.id } }"
              class="topic-block row-link"
              :aria-label="rowLabel(data, 'active')"
              :data-testid="`home-row-active-${data.id}`"
            >
              <span class="topic-cell">{{ data.topic }}</span>
              <span class="row-id">#{{ shortId(data.id) }}</span>
            </router-link>
          </template>
        </Column>
        <Column header="Started">
          <template #body="{ data }">
            <div class="date-block">
              <span class="date-cell">{{ formatDate(data.created_at) }}</span>
              <span class="date-rel">{{ formatRelative(data.created_at) }}</span>
            </div>
          </template>
        </Column>
      </DataTable>
    </template>

    <template v-else>
      <div v-if="!endedSessions.length" class="empty" data-testid="home-empty-ended">
        <p class="empty-eyebrow">page 01</p>
        <p class="empty-line">Nothing archived yet.</p>
        <p class="empty-sub">When you end a session, it lands here.</p>
      </div>

      <DataTable
        v-else
        :value="endedSessions"
        data-testid="home-sessions-ended"
        class="table table-ended"
        :row-class="() => 'session-row'"
        @row-click="onRowClick"
      >
        <Column field="topic" header="Topic">
          <template #body="{ data }">
            <router-link
              :to="{ name: 'session', params: { id: data.id } }"
              class="topic-block row-link"
              :aria-label="rowLabel(data, 'ended')"
              :data-testid="`home-row-ended-${data.id}`"
            >
              <span class="topic-cell">{{ data.topic }}</span>
              <span class="row-id">#{{ shortId(data.id) }}</span>
            </router-link>
          </template>
        </Column>
        <Column header="Ended">
          <template #body="{ data }">
            <div class="date-block">
              <span class="date-cell">{{ formatDate(data.ended_at) }}</span>
              <span class="date-rel">{{ formatRelative(data.ended_at) }}</span>
            </div>
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              label="Resume"
              icon="pi pi-refresh"
              icon-pos="right"
              severity="secondary"
              :data-testid="`home-resume-${data.id}`"
              :loading="resumingId === data.id"
              :disabled="!!resumingId"
              class="resume-btn"
              @click="resume(data)"
            />
          </template>
        </Column>
      </DataTable>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'

import * as sessionsApi from '../services/sessionsApi.js'
import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'
import {
  formatDate,
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

// Active rows that share a topic with a newer active row — cleanup ends these.
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

function onRowClick({ data, originalEvent }) {
  // Skip when click landed on the inner topic-link (it already navigates) or a button.
  const target = originalEvent?.target
  if (target?.closest?.('.row-link, button, a')) return
  router.push({ name: 'session', params: { id: data.id } })
}

async function resume(row) {
  resumingId.value = row.id
  try {
    await store.reopenSession(row.id)
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
    await Promise.all(ids.map((id) => sessionsApi.endSession(id)))
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
  max-width: 56rem;
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
  font-size: 2.25rem;
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
  max-width: 32rem;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--color-border-strong);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: 0;
  padding: 0.625rem 0.875rem;
  margin-bottom: -1px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
  border-bottom: 2px solid transparent;
  transition: color 180ms ease, border-color 180ms ease;
}

.tab:hover,
.tab:focus-visible {
  color: var(--color-heading);
  outline: none;
}

.tab-active {
  color: var(--color-heading);
  border-bottom-color: var(--color-heading);
}

.table :deep(tr.session-row) {
  cursor: pointer;
}

.row-link {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-sm, 4px);
}

.row-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.row-link:hover .topic-cell {
  color: var(--color-accent);
}

.tab-count {
  display: inline-block;
  min-width: 1.5rem;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-faint);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0 0.4rem;
  line-height: 1.4;
}

.tab-active .tab-count {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.empty {
  text-align: left;
  padding: 3rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
  margin: 0;
}

.empty-line {
  font-family: var(--font-serif);
  font-size: 1.5rem;
  font-style: italic;
  color: var(--color-heading);
  margin: 0;
}

.empty-sub {
  margin: 0;
  color: var(--color-text-muted);
}

.inline-link {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--color-heading);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error);
}

.table :deep(.p-datatable),
.table :deep(.p-datatable-table-container),
.table :deep(.p-datatable-table) {
  background: transparent;
}

.table :deep(thead th) {
  background: transparent;
  border-bottom: 1px solid var(--color-border-strong);
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 500;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding: 0.75rem 0.5rem;
}

.table :deep(tbody td) {
  border-bottom: 1px solid var(--color-border);
  padding: 1rem 0.5rem;
  background: transparent;
  cursor: pointer;
  transition: background 180ms ease;
}

.table :deep(tbody tr:hover td) {
  background: var(--color-surface);
}

/* Ended-tab rows are not clickable as a whole — only the Resume button. */
.table-ended :deep(tbody td) {
  cursor: default;
}

.table-ended :deep(tbody tr:hover td) {
  background: transparent;
}

.topic-block {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.topic-cell {
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  color: var(--color-heading);
}

.row-id {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
}

.date-block {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.date-cell {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
}

.date-rel {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
}

.cta :deep(.p-button),
.cta.p-button {
  background: var(--color-heading);
  color: var(--color-background);
  border: 1px solid var(--color-heading);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.625rem 1.25rem;
  border-radius: var(--radius-sm);
  transition: background 180ms ease, transform 180ms ease;
}

.cta :deep(.p-button):hover,
.cta.p-button:hover {
  background: var(--color-accent);
  border-color: var(--color-accent);
  transform: translateY(-1px);
}

.resume-btn :deep(.p-button),
.resume-btn.p-button {
  background: transparent;
  color: var(--color-heading);
  border: 1px solid var(--color-border-strong);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.375rem 0.875rem;
  border-radius: var(--radius-sm);
  transition: all 180ms ease;
}

.resume-btn :deep(.p-button):not(:disabled):hover,
.resume-btn.p-button:not(:disabled):hover {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-background);
}

.dupe-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border-strong);
  border-left: 3px solid var(--signal-error);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.dupe-line {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
}

.dupe-btn :deep(.p-button),
.dupe-btn.p-button {
  background: transparent;
  color: var(--color-heading);
  border: 1px solid var(--color-border-strong);
  font-family: var(--font-sans);
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  transition: all 180ms ease;
}

.dupe-btn :deep(.p-button):not(:disabled):hover,
.dupe-btn.p-button:not(:disabled):hover {
  background: var(--color-heading);
  color: var(--color-background);
}
</style>

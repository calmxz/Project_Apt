<template>
  <section class="home">
    <header class="head">
      <div class="head-text">
        <span class="folio">your shelf</span>
        <h1 class="title">Sessions</h1>
        <p class="lede">
          <template v-if="store.sessions.length">
            {{ store.sessions.length }} {{ store.sessions.length === 1 ? 'volume' : 'volumes' }} so far. Pick up where you left off.
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

    <hr class="hairline" />

    <p v-if="store.loading" class="muted">Loading...</p>
    <p v-else-if="store.error" class="error" data-testid="home-error">{{ store.error }}</p>
    <div v-else-if="!store.sessions.length" class="empty" data-testid="home-empty">
      <p class="empty-eyebrow">page 01</p>
      <p class="empty-line">No sessions yet.</p>
      <p class="empty-sub">Start your first one — the tutor will adapt as you go.</p>
    </div>

    <DataTable
      v-else
      :value="store.sessions"
      data-testid="home-sessions"
      class="table"
      @row-click="onRowClick"
    >
      <Column field="topic" header="Topic">
        <template #body="{ data }">
          <span class="topic-cell">{{ data.topic }}</span>
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }">
          <span :class="['status-pill', data.ended_at ? 'status-ended' : 'status-active']">
            {{ data.ended_at ? 'Ended' : 'Active' }}
          </span>
        </template>
      </Column>
      <Column header="Started">
        <template #body="{ data }">
          <span class="date-cell">{{ formatDate(data.created_at) }}</span>
        </template>
      </Column>
    </DataTable>
  </section>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'

import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'
import { formatDate } from '../utils/formatDate.js'

const router = useRouter()
const store = useSessionStore()
const user = useUserStore()

onMounted(async () => {
  if (user.userId) await store.listSessions(user.userId).catch(() => {})
})

function goNew() {
  router.push({ name: 'new-session' })
}

function onRowClick({ data }) {
  router.push({ name: 'session', params: { id: data.id } })
}
</script>

<style scoped>
.home {
  max-width: 56rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
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

.muted {
  color: var(--color-text-muted);
}

.error {
  color: var(--signal-error);
}

.table :deep(.p-datatable) {
  background: transparent;
}

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

.topic-cell {
  font-family: var(--font-serif);
  font-size: 1.0625rem;
  color: var(--color-heading);
}

.date-cell {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
}

.status-pill {
  display: inline-block;
  padding: 0.125rem 0.625rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  border-radius: 999px;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
}

.status-active {
  border-color: var(--color-accent);
  color: var(--color-accent);
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
</style>

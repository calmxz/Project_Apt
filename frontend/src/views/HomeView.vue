<template>
  <section class="home">
    <header class="head">
      <h1>Sessions</h1>
      <Button
        label="New session"
        icon="pi pi-plus"
        data-testid="home-new-session"
        @click="goNew"
      />
    </header>

    <p v-if="store.loading" class="muted">Loading...</p>
    <p v-else-if="store.error" class="error" data-testid="home-error">{{ store.error }}</p>
    <p v-else-if="!store.sessions.length" class="muted" data-testid="home-empty">
      No sessions yet. Start your first one.
    </p>

    <DataTable
      v-else
      :value="store.sessions"
      data-testid="home-sessions"
      striped-rows
      class="table"
      @row-click="onRowClick"
    >
      <Column field="topic" header="Topic" />
      <Column header="Status">
        <template #body="{ data }">
          <Tag
            :value="data.ended_at ? 'Ended' : 'Active'"
            :severity="data.ended_at ? 'secondary' : 'success'"
          />
        </template>
      </Column>
      <Column header="Started">
        <template #body="{ data }">{{ formatDate(data.created_at) }}</template>
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
import Tag from 'primevue/tag'

import { useSessionStore } from '../stores/session.js'
import { useUserStore } from '../stores/user.js'

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

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString()
}
</script>

<style scoped>
.home {
  max-width: 56rem;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.muted {
  color: var(--color-text-muted, #888);
}
.error {
  color: #c33;
}
.table {
  cursor: pointer;
}
</style>

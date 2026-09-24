<script setup>
// PROTOTYPE host for wayfinder ticket #358: three variants of the aggregate
// learner profile page, switchable via ?variant=A|B|C on /prototype/profile.
// Throwaway: lives on branch prototype/profile-page, never merges.
//
// Data: the real aggregate endpoint when it has sessions; otherwise the
// fixture. ?data=fixture forces the fixture, ?state=empty forces the
// zero-session shape so the empty page can be judged too.
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import EmptyState from '../../components/EmptyState.vue'
import PrototypeSwitcher from '../../components/PrototypeSwitcher.vue'
import { getAggregateProfile } from '../../services/profileApi.js'
import VariantA from './profile/VariantA.vue'
import VariantB from './profile/VariantB.vue'
import VariantC from './profile/VariantC.vue'
import { buildEmptyFixture, buildFixture } from './profileFixture.js'

const VARIANTS = [
  { key: 'A', name: 'Dividers across sessions', component: VariantA },
  { key: 'B', name: 'Topic ledger', component: VariantB },
  { key: 'C', name: 'Concept ledger', component: VariantC },
]

const route = useRoute()
const data = ref(null)
const source = ref('')

const variantKey = computed(() => {
  const k = String(route.query.variant || 'A').toUpperCase()
  return VARIANTS.some((v) => v.key === k) ? k : 'A'
})
const variant = computed(() => VARIANTS.find((v) => v.key === variantKey.value))
const isEmpty = computed(() => (data.value?.total_sessions ?? 0) === 0)

onMounted(async () => {
  if (route.query.state === 'empty') {
    data.value = buildEmptyFixture()
    source.value = 'fixture (empty)'
    return
  }
  if (route.query.data === 'fixture') {
    data.value = buildFixture()
    source.value = 'fixture'
    return
  }
  try {
    const live = await getAggregateProfile()
    if ((live?.total_sessions ?? 0) > 0) {
      data.value = live
      source.value = 'live'
      return
    }
  } catch {
    // fall through to the fixture
  }
  data.value = buildFixture()
  source.value = 'fixture (live had no sessions or failed)'
})
</script>

<template>
  <div class="proto-page" data-testid="prototype-profile">
    <p class="proto-note">prototype: data = {{ source || 'loading' }}</p>
    <EmptyState
      v-if="data && isEmpty"
      tone="celebrate"
      headline="No sessions yet"
      subtext="Start one. Your profile builds itself as you go."
    >
      <template #cta>
        <router-link to="/" class="proto-link">Start your first session</router-link>
      </template>
    </EmptyState>
    <component :is="variant.component" v-else-if="data" :data="data" />
    <PrototypeSwitcher :variants="VARIANTS" :current="variantKey" />
  </div>
</template>

<style scoped>
.proto-page {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 4rem;
}

.proto-note {
  margin: 0;
  font:
    0.75rem/1.4 ui-monospace,
    monospace;
  color: var(--pencil);
}

.proto-link {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  color: var(--ink-learner);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>

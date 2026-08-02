<template>
  <section class="settings" data-testid="settings">
    <header class="head">
      <span class="folio">preferences</span>
      <h1 class="title">Settings</h1>
    </header>

    <div class="layout">
      <nav
        class="rail"
        role="tablist"
        aria-label="Settings sections"
        data-testid="settings-tab-rail"
      >
        <button
          v-for="(t, i) in tabs"
          :key="t.slug"
          :ref="(el) => (tabRefs[i] = el)"
          role="tab"
          :id="`tab-${t.slug}`"
          :aria-controls="`panel-${t.slug}`"
          :aria-selected="t.slug === tab ? 'true' : 'false'"
          :tabindex="t.slug === tab ? 0 : -1"
          :class="['rail-tab', { 'rail-tab--active': t.slug === tab }]"
          :data-testid="`settings-tab-${t.slug}`"
          type="button"
          @click="activate(i)"
          @keydown="onKeydown($event, i)"
        >
          <i :class="['pi', t.icon]" aria-hidden="true" />
          <span>{{ t.label }}</span>
        </button>
      </nav>

      <div
        class="panel"
        role="tabpanel"
        :id="`panel-${tab}`"
        :aria-labelledby="`tab-${tab}`"
        tabindex="0"
      >
        <KeepAlive>
          <component :is="activeComponent" />
        </KeepAlive>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'

import ProfileTab from '../components/settings/ProfileTab.vue'
import UsageTab from '../components/settings/UsageTab.vue'
import AccountTab from '../components/settings/AccountTab.vue'
import AppearanceTab from '../components/settings/AppearanceTab.vue'

const props = defineProps({
  tab: { type: String, default: 'profile' },
})

const router = useRouter()

const tabs = [
  { slug: 'profile', label: 'Profile', icon: 'pi-user', component: ProfileTab },
  { slug: 'usage', label: 'Usage', icon: 'pi-wallet', component: UsageTab },
  { slug: 'account', label: 'Account', icon: 'pi-lock', component: AccountTab },
  { slug: 'appearance', label: 'Appearance', icon: 'pi-moon', component: AppearanceTab },
]

const activeComponent = computed(
  () => (tabs.find((t) => t.slug === props.tab) || tabs[0]).component,
)

const tabRefs = ref([])

async function activate(i) {
  const slug = tabs[i].slug
  if (slug !== props.tab) {
    await router.push({ name: 'settings', params: { tab: slug } })
  }
  await nextTick()
  tabRefs.value[i]?.focus()
}

function onKeydown(e, i) {
  let nextIndex = null
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIndex = (i + 1) % tabs.length
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIndex = (i - 1 + tabs.length) % tabs.length
  if (nextIndex === null) return
  e.preventDefault()
  activate(nextIndex)
}
</script>

<style scoped>
.settings {
  max-width: 72rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.head {
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
  color: var(--color-accent-text);
}

.title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.layout {
  display: grid;
  grid-template-columns: 12rem 1fr;
  gap: 2rem;
  align-items: start;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  position: sticky;
  top: 1rem;
}

.rail-tab {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease;
}

.rail-tab:hover {
  background: var(--color-surface-soft);
  color: var(--color-heading);
}

.rail-tab--active {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
}

.rail-tab:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@media (max-width: 48rem) {
  .layout {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .rail {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }

  .rail-tab {
    flex-shrink: 0;
  }
}
</style>

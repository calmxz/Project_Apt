<template>
  <section class="settings" data-testid="settings">
    <header class="head">
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
          :class="['rail-tab', 'coarse-2x', { 'rail-tab--active': t.slug === tab }]"
          :data-testid="`settings-tab-${t.slug}`"
          type="button"
          @click="activate(i)"
          @keydown="onKeydown($event, i)"
        >
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

// The rail is the contents list of this section: one row per page, no icons.
const tabs = [
  { slug: 'profile', label: 'Profile', component: ProfileTab },
  { slug: 'usage', label: 'Usage', component: UsageTab },
  { slug: 'account', label: 'Account', component: AccountTab },
  { slug: 'appearance', label: 'Appearance', component: AppearanceTab },
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
  display: flex;
  flex-direction: column;
}

/* The sheet header: one display line under a strong rule. */
.head {
  display: flex;
  flex-direction: column;
  padding-bottom: var(--line-pitch);
  border-bottom: 1px solid var(--rule-strong);
}

.title {
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
  margin: 0;
}

/* The page uses the full width: title on a strong rule, one pitch, then the
   contents list laid down as one ruled tab line (the sidebar's own Active /
   Ended grammar), then the panel full width beneath it. */
.layout {
  display: flex;
  flex-direction: column;
}

.rail {
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
  overflow-x: auto;
  position: static;
  padding: 0;
  border-bottom: 1px solid var(--rule-strong);
  margin-top: var(--line-pitch);
}

/* Blue caption-700 toggles; the one in force turns graphite with a 2px
   graphite underline, the tab line held on the pitch (28px + the 1px
   border below it). */
.rail-tab {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: calc(var(--line-pitch) - 1px);
  text-align: left;
  cursor: pointer;
}

.rail-tab:hover {
  background: transparent;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.rail-tab--active {
  color: var(--ink);
  box-shadow: inset 0 -2px 0 var(--ink);
}

.rail-tab:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: 2px;
}

/* The page runs full width beneath the tab line; each tab lays its own
   sections out (see ProfileTab, AccountTab). */
.panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--line-pitch);
  padding: var(--line-pitch) 0 0;
  border-left: 0;
}

.panel:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
</style>

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
          :class="['rail-tab', { 'rail-tab--active': t.slug === tab }]"
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
  max-width: 72rem;
  margin: 0 auto;
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

/* Cue column width on the left, the page on the right: the same 232px
   measure the session sheet gives its cue column. */
.layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  padding-top: var(--line-pitch);
}

.rail {
  display: flex;
  flex-direction: column;
  align-self: start;
  position: sticky;
  top: var(--line-pitch);
  padding-right: 1.5rem;
}

/* Contents rows: one page per line, the line at the pitch, nothing stamped. */
.rail-tab {
  display: flex;
  align-items: center;
  padding: 0 0.25rem 0 0.75rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-sans);
  /* contents size: the sidebar's own size for a list of pages */
  font-size: 0.9375rem;
  font-weight: 400;
  line-height: var(--line-pitch);
  text-align: left;
  cursor: pointer;
}

.rail-tab:hover {
  background: var(--color-surface-soft);
}

.rail-tab--active {
  font-weight: 700;
}

.rail-tab:focus-visible {
  outline: 2px solid var(--ink-learner);
  outline-offset: -2px;
}

/* The rule between contents and page runs the full height of the sheet, the
   way the sidebar edge and the margin rule do. */
.panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--line-pitch);
  padding-left: 1.5rem;
  border-left: 1px solid var(--rule-strong);
}

.panel:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* Under 48rem the contents list lies down as one ruled tab line and the page
   runs full width beneath it. */
@media (max-width: 48rem) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .rail {
    position: static;
    flex-direction: row;
    gap: 1.25rem;
    overflow-x: auto;
    padding-right: 0;
    border-bottom: 1px solid var(--rule-strong);
  }

  .rail-tab {
    flex-shrink: 0;
    padding: 0;
    color: var(--ink-learner);
    font-size: var(--fs-caption);
    font-weight: 700;
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

  .panel {
    padding-left: 0;
    padding-top: var(--line-pitch);
    border-left: 0;
  }
}
</style>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // TopicProfile as served by the API: knowledge_level, subtopic_levels,
  // confirmed_gaps[], mastered_concepts[], focus_target_gap.
  profile: { type: Object, default: null },
  // Discriminator: a different session reseeds the "already seen" set so
  // switching sessions never replays the reveal for pre-existing entries.
  sessionId: { type: String, default: '' },
  // Cue currently under an open check batch; marked, never recoloured.
  testingGap: { type: String, default: '' },
})

const emit = defineEmits(['landed'])

// Five stepped stroke weights. KnowledgeLevel carries three values, so the
// scale reads: unset hairline, then three inked steps with one step of
// headroom below the top so "advanced" sits at the top of the scale.
const LEVEL_STEPS = [0.75, 1.5, 2.25, 3, 3.75]
const LEVEL_STEP_INDEX = { beginner: 1, intermediate: 2, advanced: 4 }

// ConceptEntry is { name, evidence_type, last_event_at }; legacy blobs and the
// gap-picker path hand over bare strings.
function entryName(e) {
  return typeof e === 'string' ? e : (e?.name ?? '')
}

const level = computed(() => props.profile?.knowledge_level ?? null)
const levelLabel = computed(() => level.value || 'level not set')
const levelStroke = computed(() => LEVEL_STEPS[LEVEL_STEP_INDEX[level.value] ?? 0])

const focus = computed(() => props.profile?.focus_target_gap || '')
const gaps = computed(() => (props.profile?.confirmed_gaps ?? []).map(entryName).filter(Boolean))
const mastered = computed(() =>
  (props.profile?.mastered_concepts ?? []).map(entryName).filter(Boolean),
)
// The focus cue has its own section; listing it twice would read as two gaps.
const openGaps = computed(() => gaps.value.filter((g) => g !== focus.value))

// The strip counts what the Gaps section actually lists, and says "1 gap".
// "mastered" is already a participle, so it never takes a plural.
const gapsCount = computed(() =>
  openGaps.value.length === 1 ? '1 gap' : `${openGaps.value.length} gaps`,
)

const subtopics = computed(() => {
  const map = props.profile?.subtopic_levels ?? {}
  return Object.keys(map).map((name) => ({
    name,
    level: map[name],
    stroke: LEVEL_STEPS[LEVEL_STEP_INDEX[map[name]] ?? 0],
  }))
})

// Cue-lands. Every name currently on the page as one flat list; the first
// non-null profile for a session seeds the set without animating, and only
// later additions get the ink reveal.
const allNames = computed(() => [
  ...(focus.value ? [`focus:${focus.value}`] : []),
  ...openGaps.value.map((g) => `gap:${g}`),
  ...mastered.value.map((m) => `mastered:${m}`),
])

const seen = ref(new Set())
const fresh = ref(new Set())
let seededFor = null

watch(
  [() => props.sessionId, () => props.profile, allNames],
  ([sid, profile, names]) => {
    if (!profile) return
    if (sid !== seededFor) {
      seededFor = sid
      seen.value = new Set(names)
      fresh.value = new Set()
      return
    }
    const added = names.filter((n) => !seen.value.has(n))
    seen.value = new Set(names)
    if (!added.length) return
    fresh.value = new Set(added)
    emit('landed', added)
  },
  { immediate: true },
)

function isFresh(key) {
  return fresh.value.has(key)
}

// Below 900px the column collapses to the strip; the disclosure expands the
// same sections in place. The switch is CSS-only (see the media block), so
// there is one instance and one landed stream at every width.
const expanded = ref(false)
</script>

<template>
  <aside
    class="cue"
    :class="{ 'is-expanded': expanded }"
    data-testid="cue-column"
    aria-label="What the tutor knows"
  >
    <div class="cue-strip" data-testid="cue-strip">
      <p class="cue-strip-line">
        <span v-if="focus" class="cue-strip-focus">
          <svg
            class="cue-mark cue-mark--focus"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M1 6 L11 6" />
          </svg>
          <span class="cue-strip-focus-word">{{ focus }}</span>
        </span>
        <span v-else class="cue-strip-focus cue-strip-focus--none">no focus cue yet</span>
        <span class="cue-strip-count" data-tabular>{{ gapsCount }}</span>
        <span class="cue-strip-count" data-tabular>{{ mastered.length }} mastered</span>
      </p>
      <button
        type="button"
        class="cue-disclosure hit-44"
        data-testid="cue-disclosure"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-label="expanded ? 'Hide what the tutor knows' : 'Show what the tutor knows'"
        @click="expanded = !expanded"
      >
        <svg
          class="cue-disclosure-mark"
          viewBox="0 0 20 20"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path :d="expanded ? 'M5 12 L10 7 L15 12' : 'M5 8 L10 13 L15 8'" />
        </svg>
      </button>
    </div>

    <div class="cue-body">
      <section class="cue-section">
        <h2 class="cue-heading">Focus</h2>
        <p
          v-if="focus"
          class="cue-entry cue-entry--focus"
          :class="{ 'is-fresh': isFresh(`focus:${focus}`) }"
          data-testid="cue-focus"
        >
          <svg
            class="cue-mark cue-mark--focus"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M1 6 L11 6" />
          </svg>
          <span class="cue-word">{{ focus }}</span>
        </p>
        <p v-else class="cue-none">no focus cue yet</p>
      </section>

      <section class="cue-section">
        <h2 class="cue-heading">Gaps</h2>
        <ul v-if="openGaps.length" class="cue-list">
          <li
            v-for="g in openGaps"
            :key="g"
            class="cue-entry"
            :class="{ 'is-fresh': isFresh(`gap:${g}`) }"
            data-testid="cue-gap"
          >
            <svg
              class="cue-mark cue-mark--gap"
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="6" cy="6" r="4" />
            </svg>
            <span class="cue-word" :class="{ 'is-testing': testingGap && testingGap === g }">{{
              g
            }}</span>
          </li>
        </ul>
        <p v-else class="cue-none">none open</p>
      </section>

      <section class="cue-section">
        <h2 class="cue-heading">Mastered</h2>
        <ul v-if="mastered.length" class="cue-list">
          <li
            v-for="m in mastered"
            :key="m"
            class="cue-entry"
            :class="{ 'is-fresh': isFresh(`mastered:${m}`) }"
            data-testid="cue-mastered"
          >
            <svg
              class="cue-mark cue-mark--tick"
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 6.5 L4.8 9.2 L10 3.2" />
            </svg>
            <span class="cue-word">{{ m }}</span>
          </li>
        </ul>
        <p v-else class="cue-none">none yet</p>
      </section>

      <section class="cue-section">
        <h2 class="cue-heading">Level</h2>
        <p class="cue-level" :class="{ 'is-unset': !level }" data-testid="cue-level">
          <svg
            class="cue-level-mark"
            viewBox="0 0 24 24"
            width="24"
            height="16"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 17 L22 7" :stroke-width="levelStroke" />
          </svg>
          <span class="cue-level-label">{{ levelLabel }}</span>
        </p>
        <ul v-if="subtopics.length" class="cue-list cue-list--subtopics">
          <li v-for="s in subtopics" :key="s.name" class="cue-subtopic" data-testid="cue-subtopic">
            <svg
              class="cue-level-mark"
              viewBox="0 0 24 24"
              width="18"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 17 L22 7" :stroke-width="s.stroke" />
            </svg>
            <span class="cue-subtopic-name">{{ s.name }}</span>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.cue {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.cue-body {
  display: flex;
  flex-direction: column;
  gap: var(--line-pitch);
  padding: var(--line-pitch) 1.25rem var(--line-pitch) 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--rule-strong) transparent;
}

.cue-section {
  display: flex;
  flex-direction: column;
}

.cue-heading {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.cue-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cue-entry,
.cue-none,
.cue-level,
.cue-subtopic {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  overflow-wrap: anywhere;
}

.cue-word {
  color: var(--ink-learner);
}

/* The focus cue and the cue under an open check stay in ink and are marked in
   red; the word itself is never set in red. */
.cue-entry--focus .cue-word,
.cue-word.is-testing {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--ink-marker);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.cue-none {
  color: var(--pencil);
}

/* Marks sit on the first line of the pitch, so a cue that wraps keeps its
   mark beside its first word rather than floating mid-block. */
.cue-mark {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: calc((var(--line-pitch) - 12px) / 2);
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.cue-mark--focus {
  stroke: var(--ink-marker);
  stroke-width: 2;
}

.cue-mark--gap {
  stroke: var(--pencil);
}

.cue-mark--tick {
  stroke: var(--ink-learner);
}

.cue-level-mark {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: calc((var(--line-pitch) - 16px) / 2);
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
}

.cue-subtopic .cue-level-mark {
  margin-top: calc((var(--line-pitch) - 12px) / 2);
}

.cue-level.is-unset .cue-level-mark {
  stroke: var(--pencil);
}

.cue-level-label,
.cue-subtopic-name {
  color: var(--pencil);
}

/* Cue-lands: a newly recorded cue writes itself in, left to right. */
.cue-entry.is-fresh {
  animation: cue-land var(--motion-ink) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes cue-land {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}

/* The strip is the sub-900px form; hidden while the column has its own width. */
.cue-strip {
  display: none;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
}

.cue-strip-line {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin: 0;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  white-space: nowrap;
  overflow: hidden;
}

.cue-strip-focus {
  display: inline-flex;
  align-items: baseline;
  gap: 0.375rem;
  min-width: 0;
  color: var(--ink);
}

.cue-strip-focus-word {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cue-strip-focus--none {
  color: var(--pencil);
}

.cue-strip-count {
  flex: 0 0 auto;
  color: var(--pencil);
}

.cue-disclosure {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--ink-learner);
  cursor: pointer;
}

.cue-disclosure-mark {
  flex: 0 0 auto;
}

.cue-disclosure:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (max-width: 899px) {
  /* R2: the strip stays put while the body under it scrolls, so the disclosure
     control is always reachable without hunting for it. */
  .cue-strip {
    display: grid;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--color-surface);
    padding: 0 clamp(1rem, 3vw, 1.5rem);
  }

  /* R2: the expanded profile is capped here rather than on the parent strip.
     Without the cap a long profile pushed the notes column down in flow, which
     collapsed the transcript to 0px and put the composer below the viewport. */
  .cue-body {
    display: none;
    padding: 0 clamp(1rem, 3vw, 1.5rem) 0.5rem;
    gap: 0.5rem;
    max-height: 40vh;
    overflow-y: auto;
  }

  .cue.is-expanded .cue-body {
    display: flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cue-entry.is-fresh {
    animation: none;
  }
}
</style>

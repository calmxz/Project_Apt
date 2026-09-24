<template>
  <section class="review">
    <BackButton label="Back" fallback="/" />
    <header class="head">
      <h1 class="title">Recall</h1>
      <p class="lede">Concepts due for a quick check.</p>
      <p class="lede">Each check that you get right extends the gap before the next one.</p>
    </header>

    <div v-if="showSkeleton" class="skel" data-testid="review-loading" aria-hidden="true">
      <span class="skel-block" />
      <span class="skel-block" />
      <span class="skel-block skel-short" />
    </div>
    <span v-if="showSkeleton" class="sr-only" role="status">Loading</span>

    <template v-else-if="error">
      <p class="error" data-testid="review-error">Could not load your recall queue.</p>
      <button type="button" class="review-more" data-testid="review-retry" @click="retry">
        Retry
      </button>
    </template>

    <component
      :is="variantComponent"
      v-else-if="loaded"
      :items="items"
      :busy="startBusy"
      @start="startReview"
    />

    <p v-if="flash" class="flash" role="status">{{ flash }}</p>

    <PrototypeSwitcher v-if="isDevBuild" />
  </section>
</template>

<script setup>
// PROTOTYPE - three variants of the Recall page on the existing /review
// route, switchable via ?variant=A|B|C (see src/prototype/recallProto.js).
// Data fetching, error and skeleton are the real page's; only the rendered
// subtree below the header changes per variant.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BackButton from '../components/BackButton.vue'
import PrototypeSwitcher from '../prototype/PrototypeSwitcher.vue'
import RecallVariantA from '../prototype/recall/RecallVariantA.vue'
import RecallVariantB from '../prototype/recall/RecallVariantB.vue'
import RecallVariantC from '../prototype/recall/RecallVariantC.vue'
import { fakeData, fakeItems, variant } from '../prototype/recallProto.js'
import { useSessionStore } from '../stores/session.js'
import { getReviewQueue } from '../services/reviewApi.js'

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const isDevBuild = import.meta.env.DEV

const VARIANT_COMPONENTS = { A: RecallVariantA, B: RecallVariantB, C: RecallVariantC }
const variantComponent = computed(() => VARIANT_COMPONENTS[variant.value] || RecallVariantA)

const items = ref([])
const loaded = ref(false)
const startBusy = ref(false)
const loading = ref(false)
const error = ref(false)
const flash = ref('')

const showSkeleton = computed(() => loading.value && !items.value.length)

onMounted(() => {
  load()
})

async function load() {
  loading.value = true
  error.value = false
  fakeData.value = false
  try {
    if (route.query.empty) {
      items.value = []
    } else {
      // Prototype pulls the whole queue at once; the 3-row / "View all" split
      // of the real page is noise for judging structure.
      const page = await getReviewQueue({ limit: 100, offset: 0 }, { silent: true })
      items.value = page.items
      if (!items.value.length) {
        items.value = fakeItems()
        fakeData.value = true
      }
    }
  } catch {
    // Prototype: a dead backend still shows the structures. The real page
    // keeps failure and emptiness apart (D-11); that rule returns with the
    // fold-in. ?strict=1 keeps the honest error path for a look.
    if (route.query.strict) {
      items.value = []
      error.value = true
    } else {
      items.value = fakeItems()
      fakeData.value = true
    }
  } finally {
    loading.value = false
    loaded.value = true
  }
}

function retry() {
  return load()
}

let flashTimer = null
function say(text) {
  flash.value = text
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 2600)
}

async function startReview(item) {
  if (startBusy.value) return
  // Fake items never touch the backend: no session is created, the page
  // just says what the real action would do.
  if (item.fake) {
    say(
      `Would start a Recall check on "${item.concept}" in a new session continued from ${item.source_topic}.`,
    )
    return
  }
  startBusy.value = true
  try {
    const created = await store.continueTopic({
      id: item.source_session_id,
      topic: item.source_topic,
    })
    if (created) {
      router.push({
        name: 'session',
        params: { id: created.id },
        query: { review_gap: item.concept },
      })
    }
  } catch {
    // store.continueTopic rethrows after _setError; swallow so the busy
    // flag always clears.
  } finally {
    startBusy.value = false
  }
}
</script>

<style scoped>
.review {
  max-width: 44rem;
  margin: 0 auto;
  padding-top: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.head {
  display: flex;
  flex-direction: column;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-display);
  color: var(--ink);
}

.lede {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.skel {
  display: flex;
  flex-direction: column;
}

.skel-block {
  display: block;
  height: 1.75rem;
  border-bottom: 1px solid var(--rule-strong);
}

.skel-short {
  width: 55%;
}

.error {
  margin: 0;
  max-width: 42rem;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink-marker-text);
}

.review-more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-learner);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--lh-body);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.review-more:hover {
  color: var(--color-accent-hover);
}

.review-more:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

/* Prototype-only: the stubbed action's echo, in pencil. */
.flash {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--lh-body);
  color: var(--pencil);
}
</style>

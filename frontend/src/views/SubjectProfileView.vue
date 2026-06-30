<template>
  <section class="smap" data-testid="subject-profile">
    <header class="head">
      <span class="folio">mastery map</span>
      <h1 class="title">{{ data?.subject_title || 'Subject' }}</h1>
      <router-link :to="{ name: 'subject-overview', params: { id } }" class="back-link">
        Back to overview
      </router-link>
    </header>

    <p v-if="loading" class="muted" data-testid="smap-loading">Loading...</p>
    <p v-else-if="error" class="error" data-testid="smap-error">{{ error }}</p>

    <template v-else-if="data">
      <p
        v-if="!data.mastered_concepts.length && !data.open_gaps.length && !data.lessons.length"
        class="muted"
        data-testid="smap-empty"
      >
        Nothing mapped yet. Open a lesson and start learning to build this up.
      </p>

      <template v-else>
        <div class="two-col">
          <div class="col" data-testid="smap-mastered">
            <h2 class="section-title">Mastered</h2>
            <p v-if="!data.mastered_concepts.length" class="muted">None yet.</p>
            <ul v-else class="chip-list">
              <li v-for="c in data.mastered_concepts" :key="`m-${c}`" class="chip chip-mastered">
                {{ c }}
              </li>
            </ul>
          </div>
          <div class="col" data-testid="smap-gaps">
            <h2 class="section-title">Still shaky</h2>
            <p v-if="!data.open_gaps.length" class="muted">None.</p>
            <ul v-else class="chip-list">
              <li v-for="g in data.open_gaps" :key="`g-${g}`" class="chip chip-gap">
                {{ g }}
              </li>
            </ul>
          </div>
        </div>

        <div class="by-lesson" data-testid="smap-lessons">
          <h2 class="section-title">By lesson</h2>
          <ul class="lesson-list">
            <li v-for="l in data.lessons" :key="l.lesson_id" class="lesson-row">
              <span class="lesson-name">{{ l.lesson_title }}</span>
              <span v-if="l.mastered.length" class="lesson-meta lesson-mastered">
                mastered: {{ l.mastered.join(', ') }}
              </span>
              <span v-if="l.gaps.length" class="lesson-meta lesson-gaps">
                gaps: {{ l.gaps.join(', ') }}
              </span>
              <span v-if="!l.mastered.length && !l.gaps.length" class="lesson-meta muted">
                not started
              </span>
            </li>
          </ul>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'

import { friendlyError } from '../lib/errors.js'
import { getSubjectProfile } from '../services/profileApi.js'

const props = defineProps({ id: { type: String, required: true } })

const data = ref(null)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getSubjectProfile(props.id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.smap { max-width: 72rem; margin: 0 auto; display: flex; flex-direction: column; gap: 1.75rem; }
.head { display: flex; flex-direction: column; gap: 0.5rem; }
.folio {
  font-family: var(--font-sans); font-size: var(--fs-label); text-transform: uppercase;
  letter-spacing: var(--tracking-label); font-weight: 600; color: var(--color-accent-text);
}
.title {
  font-family: var(--font-display); font-size: clamp(2rem, 4vw, 2.5rem); font-weight: 700;
  color: var(--color-heading); margin: 0;
}
.back-link { color: var(--color-accent-text); text-decoration: none; font-size: 0.9rem; }
.muted { color: var(--color-text-muted); }
.error { color: var(--color-error-text); }
.section-title {
  font-family: var(--font-display); font-size: 1.25rem; font-weight: 700;
  color: var(--color-heading); margin: 0 0 0.875rem 0;
}
.two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 2rem; }
.chip-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.chip {
  display: inline-flex; align-items: center; padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 0.875rem; font-weight: 500;
}
.chip-mastered {
  background: rgba(34, 197, 94, 0.14); color: var(--color-success-text);
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.chip-gap {
  background: rgba(255, 176, 32, 0.16); color: var(--color-warning-text);
  border: 1px solid rgba(255, 176, 32, 0.35);
}
.lesson-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.lesson-row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem;
  padding: 0.75rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md);
  background: var(--color-surface);
}
.lesson-name { font-family: var(--font-display); font-weight: 600; color: var(--color-heading); }
.lesson-meta { font-size: 0.8125rem; }
.lesson-mastered { color: var(--color-success-text); }
.lesson-gaps { color: var(--color-warning-text); }
</style>

<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue'

const props = defineProps({
  // Batch: { gap, total, currentIndex, viewIndex, setIndex, setTotal, items: [
  //   { question, options, status, selectedIndex, correctIndex, correct, explanation } ] }
  // setIndex / setTotal (1-based, #339) are optional; absent means one set.
  check: { type: Object, required: true },
  // F-04: true while a stream is live; Skip/Next/Done are disabled so the
  // follow-up stream cannot be started on top of an active one.
  busy: { type: Boolean, default: false },
  // E-17: true while this item's answer POST is in flight. `answered` only
  // flips once that POST returns, so without this the options stayed live in
  // between and a second click was swallowed by the store's silent guard.
  // Distinct from `busy`, which is about the follow-up stream.
  answering: { type: Boolean, default: false },
})
const emit = defineEmits(['answer', 'skip', 'next', 'done'])

const LETTERS = ['A', 'B', 'C', 'D', 'E']

const item = computed(() => props.check.items[props.check.viewIndex] || {})
const answered = computed(() => item.value.status === 'answered' || item.value.status === 'skipped')
const correct = computed(() => item.value.correct === true)
const isLast = computed(() => props.check.viewIndex >= props.check.total - 1)
const showProgress = computed(() => props.check.total > 1)
// Hidden-until-graded: the explanation is a raise, not a hint.
const graded = computed(() => item.value.status === 'answered')

// PROTOTYPE (#353): multi-set progress, three treatments keyed by the
// injected variant. null = shipped behaviour (no set chrome at all).
const variantRef = inject('checkSetsVariant', null)
const variant = computed(() => variantRef?.value ?? null)
const setIndex = computed(() => props.check.setIndex ?? 1)
const setTotal = computed(() => props.check.setTotal ?? 1)
const multi = computed(() => Boolean(variant.value) && setTotal.value > 1)
const answeredCount = computed(
  () => props.check.items.filter((it) => it.status !== 'pending').length,
)
// B: one segment per set; the live one fills item by item.
const segments = computed(() =>
  Array.from({ length: setTotal.value }, (_, k) => {
    const n = k + 1
    if (n < setIndex.value) return { state: 'done', fill: 1 }
    if (n === setIndex.value)
      return { state: 'live', fill: answeredCount.value / props.check.total }
    return { state: 'todo', fill: 0 }
  }),
)
// C: the sets still to come sit under the card as stacked edges.
const stackStyle = computed(() => {
  const remaining = setTotal.value - setIndex.value
  if (variant.value !== 'C' || !multi.value || remaining <= 0) return null
  const parts = ['0 1px 0 var(--card-drop)']
  for (let k = 1; k <= remaining; k += 1) {
    parts.push(`0 ${k * 4}px 0 -${k}px var(--card)`)
    parts.push(`0 ${k * 4 + 1}px 0 -${k}px var(--card-edge)`)
  }
  return { boxShadow: parts.join(', ') }
})
function markState(n) {
  if (n < setIndex.value) return 'done'
  if (n === setIndex.value) return 'live'
  return 'todo'
}

function optionClass(i) {
  if (item.value.status !== 'answered') return ''
  if (i === item.value.correctIndex) return 'is-correct'
  if (i === item.value.selectedIndex) return 'is-incorrect'
  return ''
}

const nextBtn = ref(null)
const doneBtn = ref(null)

watch(answered, async (is) => {
  if (!is) return
  await nextTick()
  const target = nextBtn.value ?? doneBtn.value
  target?.focus()
})
</script>

<template>
  <section
    class="check-card"
    :class="{ answered, correct, incorrect: answered && !correct }"
    :style="stackStyle"
    data-testid="check-card"
  >
    <div class="check-gutter" :class="{ 'is-segmented': multi && variant === 'B' }">
      <span class="role-tag">
        check<template v-if="multi && variant === 'B'">
          &middot; set {{ setIndex }} of {{ setTotal }}</template
        >
      </span>
      <p v-if="showProgress || multi" class="check-progress" data-tabular>
        <template v-if="multi && variant === 'A'"
          >set {{ setIndex }} of {{ setTotal }} &middot;
        </template>
        <span
          v-if="multi && variant === 'C'"
          class="check-setmarks"
          role="img"
          :aria-label="`Set ${setIndex} of ${setTotal}`"
        >
          <svg
            v-for="n in setTotal"
            :key="n"
            class="check-setmark"
            :class="markState(n)"
            viewBox="0 0 14 11"
            width="14"
            height="11"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1" y="1" width="12" height="9" rx="1" />
          </svg>
        </span>
        <template v-if="showProgress">{{ check.viewIndex + 1 }}/{{ check.total }}</template>
      </p>
    </div>
    <div v-if="multi && variant === 'B'" class="check-rule" aria-hidden="true">
      <span
        v-for="(s, k) in segments"
        :key="k"
        class="check-rule-seg"
        :class="s.state"
        :style="{ '--fill': s.fill }"
      ></span>
    </div>
    <p v-if="multi && variant === 'C'" class="check-setline">{{ check.gap }}</p>
    <div class="check-box">
      <p class="check-question">{{ item.question }}</p>

      <div
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="check-live"
      >
        <template v-if="graded">
          {{ correct ? 'Correct.' : 'Not quite.' }} {{ item.explanation || '' }}
        </template>
      </div>

      <ul class="check-options" :aria-busy="answering ? 'true' : undefined">
        <li v-for="(opt, i) in item.options" :key="i">
          <button
            type="button"
            class="check-option"
            :class="optionClass(i)"
            data-testid="check-option"
            :aria-disabled="answered || answering ? 'true' : undefined"
            @click="answered || answering ? undefined : emit('answer', i)"
          >
            <span class="check-letter" aria-hidden="true">{{ LETTERS[i] ?? i + 1 }}.</span>
            <span class="check-option-text">{{ opt }}</span>
            <svg
              v-if="optionClass(i) === 'is-correct'"
              class="check-mark check-mark--tick"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2.5 8.5 L6.3 12.2 L13.5 4" pathLength="1" />
            </svg>
            <svg
              v-else-if="optionClass(i) === 'is-incorrect'"
              class="check-mark check-mark--cross"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 4 L12 12" pathLength="1" />
              <path d="M12 4 L4 12" pathLength="1" />
            </svg>
          </button>
        </li>
      </ul>

      <p v-if="graded" class="check-verdict" data-testid="check-verdict">
        {{ correct ? 'Correct' : 'Not quite' }}
      </p>
      <p
        v-if="graded && item.explanation"
        class="check-explanation"
        data-testid="check-explanation"
      >
        {{ item.explanation }}
      </p>

      <button
        v-if="!answered"
        type="button"
        class="check-skip coarse-2x"
        data-testid="check-skip"
        :disabled="busy"
        @click="emit('skip')"
      >
        Skip this question
      </button>

      <button
        v-if="answered && !isLast"
        ref="nextBtn"
        type="button"
        class="check-next"
        data-testid="check-next"
        :disabled="busy"
        @click="emit('next')"
      >
        Next
      </button>
      <button
        v-if="answered && isLast"
        ref="doneBtn"
        type="button"
        class="check-next"
        data-testid="check-done"
        :disabled="busy"
        @click="emit('done')"
      >
        Done
      </button>
    </div>
  </section>
</template>

<style scoped>
/* The check card pauses the stack: same white stock as the tutor, but the
   head line carries a 3px graphite rule as part of the head, not a side
   border, and the card runs a touch wider. */
.check-card {
  max-width: 84%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 0 var(--card-drop);
  padding: 0.55rem 0.9rem 0.7rem;
}

.check-gutter {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
  padding-bottom: 0.4rem;
  border-bottom: 3px solid var(--ink);
}

.role-tag {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 400;
  color: var(--pencil);
}

.check-box {
  /* Containing block for the sr-only live region below; without it the
     absolutely positioned box resolves against the page and can grow the
     document past the fold on mobile. */
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.5rem;
  font-family: var(--font-sans);
}

/* The count sits in the head line's right slot, matching tutor/learner
   cards' timestamp -- same size as the "check" role label, pencil ink. */
.check-progress {
  margin: 0;
  flex: 0 0 auto;
  font-size: var(--fs-label);
  color: var(--pencil);
}

/* PROTOTYPE (#353) variant B: the head rule is the progress. The gutter
   drops its border and a 3px segmented rule takes its place. */
.check-gutter.is-segmented {
  border-bottom: 0;
}

.check-rule {
  display: flex;
  gap: 4px;
  height: 3px;
  margin-top: -0.5rem;
}

.check-rule-seg {
  position: relative;
  flex: 1 1 0;
  overflow: hidden;
  background: var(--rule-strong);
}

.check-rule-seg::after {
  content: '';
  position: absolute;
  inset: 0;
  width: calc(var(--fill, 0) * 100%);
  background: var(--ink);
  transition: width var(--motion-base) cubic-bezier(0.16, 1, 0.3, 1);
}

/* PROTOTYPE (#353) variant C: drawn card marks for the sets, the gap name
   as a pencil line under the head line. */
.check-setmarks {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 0.5rem;
  vertical-align: -1px;
}

.check-setmark {
  fill: none;
  stroke: var(--pencil);
  stroke-width: 1.5;
}

.check-setmark.live {
  stroke: var(--ink);
  stroke-width: 2;
}

.check-setmark.done {
  fill: var(--ink);
  stroke: var(--ink);
}

.check-setline {
  margin: -0.15rem 0 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
  color: var(--pencil);
}

.check-question {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

.check-options {
  list-style: none;
  margin: 0;
  padding: 0;
}

.check-option {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  /* Painted, not laid out: a border-bottom made every option 29px. */
  box-shadow: inset 0 -1px 0 var(--rule);
  border-radius: 0;
  padding: 0.4rem 0;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
  cursor: pointer;
}

.check-letter {
  flex: 0 0 auto;
  color: var(--ink-learner);
  font-weight: 700;
}

.check-option-text {
  flex: 1 1 auto;
  min-width: 0;
}

.check-option:not([aria-disabled='true']):hover .check-option-text {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.check-option:not([aria-disabled='true']):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.check-option[aria-disabled='true'] {
  cursor: default;
}

/* Grading is the marker's hand: red marks beside the line, never a fill. */
.check-mark {
  flex: 0 0 auto;
  align-self: center;
  fill: none;
  stroke: var(--ink-marker);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  animation: mark-draw var(--motion-base) cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes mark-draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.check-option.is-incorrect .check-option-text {
  color: var(--pencil);
}

.check-verdict {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: var(--lh-body);
  color: var(--ink);
}

.check-card.incorrect .check-verdict {
  color: var(--ink-marker-text);
}

.check-explanation {
  margin: 0;
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--ink);
}

.check-skip,
.check-next {
  align-self: flex-start;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  color: var(--ink-learner);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.check-skip:disabled,
.check-next:disabled {
  color: var(--pencil);
  cursor: default;
  pointer-events: none;
  text-decoration: none;
}

.check-skip:focus-visible,
.check-next:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .check-mark {
    animation: none;
    stroke-dashoffset: 0;
  }
}

@media (max-width: 599px) {
  .check-card {
    max-width: 92%;
  }
}

/* R1: rows have only a painted separator between them -- fine for a mouse,
   too tight to tap reliably. On coarse pointers only, grow each row and
   centre the letter and text within it; the inset box-shadow separator
   keeps the ruled look unchanged. */
@media (pointer: coarse) {
  .check-option {
    min-height: 3.5rem;
    align-items: center;
  }
}
</style>

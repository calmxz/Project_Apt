// PROTOTYPE - throwaway. Do not ship.
//
// Question (wayfinder ticket #353): how does the check card show multi-set
// progress (Set N of M, the per-set recap between sets, the straight-through
// handoff to the next set) on desktop and at 390px, inside the index-card
// grammar? Protocol is fixed by #339; this decides the visual treatment only.
//
// Three variants on the existing /session/:id route, switchable via
// ?variant=A|B|C and the floating bar at the bottom of the screen:
//   A  Written count. The head line's right slot reads "set 2 of 3 . 1/3";
//      the recap head carries "set 1 of 3". A one-line tutor lead-in sits
//      between sets. Keeps the Pencil Head Line Rule strictly.
//   B  Ruled progress. The card's 3px graphite head rule is cut into M
//      segments: done sets solid, the live set filling item by item, the
//      rest in rule-strong. No tutor prose between sets; the recap's last
//      line is a pencil signpost ("set 2 of 3 follows") and the next card
//      lands directly.
//   C  Card stack. Remaining sets show as stacked card edges beneath the
//      live card (the stack shrinks as sets close - bends the One Drop Rule
//      on purpose); the head line's right slot carries M drawn card marks
//      instead of words. Nothing at all between sets: recap lands, next card
//      lands. The gap name is a pencil line under the head line.
//
// Data: FAKE. A three-set diagnostic (3 x 3 items) is appended to the real
// thread once it loads; set 1 is already graded, set 2 is live. Answers are
// graded locally, nothing is POSTed. Switching variant re-seeds from the
// start of set 2.
import { ref, watch } from 'vue'

export const VARIANTS = [
  { key: 'A', name: 'Written count' },
  { key: 'B', name: 'Ruled progress' },
  { key: 'C', name: 'Card stack' },
]

const STORAGE_KEY = 'proto-check-sets-variant'

function readStored() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || 'A'
  } catch {
    return 'A'
  }
}

export const variant = ref(readStored())

export function setVariant(v) {
  variant.value = v
  try {
    sessionStorage.setItem(STORAGE_KEY, v)
  } catch {
    // ignore
  }
}

const SET_TOTAL = 3

const SETS = [
  {
    gap: 'photosynthesis inputs',
    items: [
      {
        question: 'Which of these is not an input to photosynthesis?',
        options: ['Carbon dioxide', 'Water', 'Oxygen', 'Light'],
        correctIndex: 2,
        explanation: 'Oxygen is a product. Carbon dioxide, water and light go in.',
      },
      {
        question: 'Where does the water used in photosynthesis mostly enter the plant?',
        options: ['Through the stomata', 'Through the roots', 'Through the cuticle'],
        correctIndex: 1,
        explanation: 'Roots take up water; stomata handle gas exchange.',
      },
      {
        question: 'Which pigment absorbs most of the light that drives photosynthesis?',
        options: ['Chlorophyll a', 'Carotene', 'Anthocyanin', 'Xanthophyll'],
        correctIndex: 0,
        explanation: 'Chlorophyll a is the primary pigment; the others are accessory.',
      },
    ],
  },
  {
    gap: 'light-dependent reactions',
    items: [
      {
        question: 'Where in the chloroplast do the light-dependent reactions happen?',
        options: ['The stroma', 'The thylakoid membranes', 'The outer membrane'],
        correctIndex: 1,
        explanation:
          'The photosystems and electron transport chain sit in the thylakoid membranes.',
      },
      {
        question: 'What is the direct source of the oxygen released during photosynthesis?',
        options: ['Carbon dioxide', 'Glucose', 'Water', 'ATP'],
        correctIndex: 2,
        explanation: 'Photolysis splits water; the oxygen atoms come from there.',
      },
      {
        question: 'Which two products of the light-dependent reactions feed the Calvin cycle?',
        options: ['ATP and NADPH', 'Glucose and oxygen', 'ADP and NADP+', 'Water and CO2'],
        correctIndex: 0,
        explanation: 'ATP supplies energy and NADPH supplies reducing power for carbon fixation.',
      },
    ],
  },
  {
    gap: 'Calvin cycle',
    items: [
      {
        question: 'Which enzyme fixes carbon dioxide in the Calvin cycle?',
        options: ['ATP synthase', 'RuBisCO', 'Amylase', 'Cytochrome b6f'],
        correctIndex: 1,
        explanation: 'RuBisCO attaches CO2 to RuBP; it is the most abundant enzyme on Earth.',
      },
      {
        question: 'What three-carbon molecule is the first stable product of carbon fixation?',
        options: ['Pyruvate', 'G3P', '3-PGA', 'Acetyl-CoA'],
        correctIndex: 2,
        explanation:
          '3-phosphoglycerate (3-PGA) forms when the unstable 6-carbon intermediate splits.',
      },
      {
        question: 'How many turns of the Calvin cycle are needed to make one G3P for export?',
        options: ['One', 'Two', 'Three', 'Six'],
        correctIndex: 2,
        explanation: 'Three CO2 molecules fixed over three turns yield one exportable G3P.',
      },
    ],
  },
]

function pendingItems(set) {
  return set.items.map((it) => ({
    question: it.question,
    options: it.options,
    status: 'pending',
    selectedIndex: null,
    correctIndex: null,
    correct: null,
    explanation: null,
  }))
}

function gradedItems(set, picks) {
  return set.items.map((it, i) => {
    const pick = picks[i]
    if (pick == null) {
      return {
        question: it.question,
        options: it.options,
        status: 'skipped',
        selectedIndex: null,
        correctIndex: it.correctIndex,
        correct: null,
        explanation: it.explanation,
      }
    }
    return {
      question: it.question,
      options: it.options,
      status: 'answered',
      selectedIndex: pick,
      correctIndex: it.correctIndex,
      correct: pick === it.correctIndex,
      explanation: it.explanation,
    }
  })
}

function batchFor(setIndex, items) {
  const set = SETS[setIndex - 1]
  return {
    gap: set.gap,
    total: set.items.length,
    currentIndex: 0,
    viewIndex: 0,
    setIndex,
    setTotal: SET_TOTAL,
    items,
  }
}

// Lead-in prose between sets is variant A's handoff; B and C carry it on the
// cards. The set-1 lead-in is the tutor's one allowed line before set 1.
function leadIn(nextIndex) {
  if (variant.value !== 'A') return null
  const gap = SETS[nextIndex - 1].gap
  return `Next, the ${gap}.`
}

function closingProse(right) {
  return (
    `That's the whole check: ${right} of 9 across the three sets. ` +
    'The Calvin cycle is where the gaps cluster, so we start there.'
  )
}

let stamp = 0
function fakeMsg(fields) {
  stamp += 1
  return {
    role: 'assistant',
    content: null,
    message_id: `proto-check-${stamp}`,
    citations: [],
    created_at: new Date(Date.now() - (20 - stamp) * 60000).toISOString(),
    status: 'complete',
    check_batch: null,
    ...fields,
  }
}

const SET1_PICKS = [2, 0, 0]

let baseMessages = null
let picksBySet = {}

function countRight() {
  let n = 0
  for (const k of Object.keys(picksBySet)) {
    picksBySet[k].forEach((p, i) => {
      if (p != null && p === SETS[k - 1].items[i].correctIndex) n += 1
    })
  }
  return n
}

export function createCheckSetsProto(store) {
  function seed() {
    if (baseMessages == null) baseMessages = store.messages.slice()
    picksBySet = { 1: SET1_PICKS }
    stamp = 0
    store.messages = [
      ...baseMessages,
      fakeMsg({
        content: "Let's see where you stand: three short sets, three questions each.",
      }),
      fakeMsg({
        check_batch: batchFor(1, gradedItems(SETS[0], SET1_PICKS)),
        content: leadIn(2),
      }),
    ]
    store.pendingCheck = batchFor(2, pendingItems(SETS[1]))
  }

  function answer(selectedIndex) {
    const pc = store.pendingCheck
    if (!pc) return
    const i = pc.currentIndex
    const item = pc.items[i]
    if (!item || item.status !== 'pending') return
    const truth = SETS[pc.setIndex - 1].items[i]
    item.status = 'answered'
    item.selectedIndex = selectedIndex
    item.correctIndex = truth.correctIndex
    item.correct = selectedIndex === truth.correctIndex
    item.explanation = truth.explanation
    pc.currentIndex = i + 1
  }

  function next() {
    const pc = store.pendingCheck
    if (pc) pc.viewIndex = pc.currentIndex
  }

  function skip() {
    const pc = store.pendingCheck
    if (!pc) return
    const i = pc.currentIndex
    const item = pc.items[i]
    if (!item || item.status !== 'pending') return
    item.status = 'skipped'
    pc.currentIndex = i + 1
    if (pc.currentIndex >= pc.total) done()
    else pc.viewIndex = pc.currentIndex
  }

  function done() {
    const pc = store.pendingCheck
    if (!pc) return
    const picks = pc.items.map((it) => (it.status === 'answered' ? it.selectedIndex : null))
    picksBySet[pc.setIndex] = picks
    const closed = pc.setIndex
    const recap = batchFor(closed, gradedItems(SETS[closed - 1], picks))
    const isLast = closed >= SET_TOTAL
    store.messages = [
      ...store.messages,
      fakeMsg({
        check_batch: recap,
        content: isLast ? closingProse(countRight()) : leadIn(closed + 1),
      }),
    ]
    store.pendingCheck = isLast ? null : batchFor(closed + 1, pendingItems(SETS[closed]))
  }

  watch(variant, seed)

  return { seed, answer, next, skip, done }
}

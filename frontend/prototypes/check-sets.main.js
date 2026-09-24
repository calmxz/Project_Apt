// PROTOTYPE - throwaway entry for check-sets.prototype.html. Do not ship.
import '../src/assets/main.css'

import { createApp, defineComponent, h, provide, reactive, watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import MessageList from '../src/components/chat/MessageList.vue'
import CheckQuestion from '../src/components/chat/CheckQuestion.vue'
import PrototypeSwitcher from '../src/prototype/PrototypeSwitcher.vue'
import { createCheckSetsProto, variant } from '../src/prototype/checkSetsProto.js'

const store = reactive({
  messages: [
    {
      role: 'user',
      content: 'Can we start with photosynthesis? I know the basics but not the detail.',
      message_id: 'u1',
      created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    },
    {
      role: 'assistant',
      content:
        'Good place to start. Photosynthesis has two halves: the light-dependent reactions, which capture energy, and the Calvin cycle, which spends it fixing carbon.',
      message_id: 'a1',
      citations: [],
      created_at: new Date(Date.now() - 24 * 60000).toISOString(),
      status: 'complete',
      check_batch: null,
    },
  ],
  pendingCheck: null,
})

const proto = createCheckSetsProto(store)

const Stage = defineComponent({
  setup() {
    provide('checkSetsVariant', variant)
    proto.seed()
    const narrow = window.matchMedia('(max-width: 899px)')
    const state = reactive({ narrow: narrow.matches })
    narrow.addEventListener('change', (e) => {
      state.narrow = e.matches
    })
    watch(
      () => store.messages.length,
      () => requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight)),
    )
    const card = () =>
      store.pendingCheck
        ? h(CheckQuestion, {
            check: store.pendingCheck,
            class: state.narrow ? 'check-inline' : undefined,
            onAnswer: proto.answer,
            onSkip: proto.skip,
            onNext: proto.next,
            onDone: proto.done,
          })
        : null
    return () =>
      h('div', { class: 'stage' }, [
        h('div', { class: 'thread' }, [
          h('div', { class: 'measure' }, [
            h(MessageList, { messages: store.messages, landed: false }),
            state.narrow ? card() : null,
          ]),
        ]),
        h('div', { class: 'foot' }, [h('div', { class: 'measure' }, [state.narrow ? null : card()])]),
        h(PrototypeSwitcher),
      ])
  },
})

const style = document.createElement('style')
style.textContent = `
  html, body { margin: 0; background: var(--desk); }
  .stage { min-height: 100vh; display: flex; flex-direction: column; }
  .thread { flex: 1 1 auto; padding: 1rem clamp(1rem, 3vw, 2rem); }
  .measure { max-width: calc(72ch + 2rem); margin: 0 auto; display: flex; flex-direction: column; gap: 0.75rem; }
  .foot { position: sticky; bottom: 0; background: var(--desk); padding: 0 clamp(1rem, 3vw, 2rem) 4rem; }
  .foot .measure { padding-top: 0.75rem; }
  .check-inline { margin-bottom: 0.75rem; }
`
document.head.appendChild(style)

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: Stage }],
})

createApp(Stage).use(router).mount('#app')

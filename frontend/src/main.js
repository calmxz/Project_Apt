import './assets/main.css'
import './assets/aura-tokens.css'
import 'primeicons/primeicons.css'
import 'katex/dist/katex.min.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth.js'
import { useTheme } from './composables/useTheme.js'
import { adaptPresetConfig } from './theme/adaptPreset.js'

const AdaptPreset = definePreset(Aura, adaptPresetConfig)

async function bootstrap() {
  const app = createApp(App)
  app.use(createPinia())
  useTheme().init()
  // Resolve Supabase session before the router guard fires, so the first
  // navigation has a deterministic auth answer rather than racing with the
  // SDK's initial getSession() call. auth.init() also re-keys the user
  // store to the resolved uid (F-08), so no separate boot-time load here.
  try {
    await useAuthStore().init()
  } catch (e) {
    // F-14: never leave a blank page - mount unauthenticated and let the
    // router guard route to /login.
    console.error('auth init failed; continuing unauthenticated', e)
  }
  app.use(router)
  app.use(PrimeVue, {
    theme: {
      preset: AdaptPreset,
      options: {
        darkModeSelector: '[data-theme="dark"]',
      },
    },
  })
  app.use(ToastService)
  app.use(ConfirmationService)

  app.mount('#app')
}

bootstrap()

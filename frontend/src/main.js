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
import { useUserStore } from './stores/user.js'
import { useTheme } from './composables/useTheme.js'
import { adaptPresetConfig } from './theme/adaptPreset.js'

const AdaptPreset = definePreset(Aura, adaptPresetConfig)

async function bootstrap() {
  const app = createApp(App)
  app.use(createPinia())
  useUserStore().loadFromLocalStorage()
  useTheme().init()
  // Resolve Supabase session before the router guard fires, so the first
  // navigation has a deterministic auth answer rather than racing with the
  // SDK's initial getSession() call.
  await useAuthStore().init()
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

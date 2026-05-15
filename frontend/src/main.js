import './assets/main.css'
import 'primeicons/primeicons.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'

import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user.js'
import { useTheme } from './composables/useTheme.js'

const AdaptPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#FBF4E8',
      100: '#F5E5C8',
      200: '#E8C994',
      300: '#D4A574',
      400: '#C28F5C',
      500: '#B8854A',
      600: '#9A6D3A',
      700: '#7B562D',
      800: '#5C4022',
      900: '#3D2B17',
      950: '#241808',
    },
  },
})

const app = createApp(App)

app.use(createPinia())
useUserStore().loadFromLocalStorage()
useTheme().init()
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: AdaptPreset,
    options: {
      darkModeSelector: '[data-theme="dark"]',
    },
  },
})

app.mount('#app')

import './assets/main.css'
import 'primeicons/primeicons.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'

import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user.js'
import { useTheme } from './composables/useTheme.js'

const AdaptPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#FFF1EF',
      100: '#FFD9D2',
      200: '#FFB5A8',
      300: '#FF8F7C',
      400: '#FF7766',
      500: '#FF6B5C',
      600: '#E25A4A',
      700: '#B5413A',
      800: '#842922',
      900: '#4D1611',
      950: '#2B0A07',
    },
    formField: {
      borderRadius: '14px',
    },
    content: {
      borderRadius: '20px',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#FFFFFF',
          50: '#F7F8FB',
          100: '#EEF0F6',
          200: '#DDE2EE',
          300: '#B7BFD2',
          400: '#7E8AA3',
          500: '#58637A',
          600: '#3F485E',
          700: '#2A3142',
          800: '#1B2030',
          900: '#141826',
          950: '#0A0D17',
        },
      },
      dark: {
        surface: {
          0: '#FFFFFF',
          50: '#1E2236',
          100: '#262B43',
          200: '#2A3050',
          300: '#3A4166',
          400: '#5B6480',
          500: '#8B95AE',
          600: '#B7BFD2',
          700: '#DDE2EE',
          800: '#EEF0F6',
          900: '#F7F8FB',
          950: '#FFFFFF',
        },
      },
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
app.use(ToastService)

app.mount('#app')

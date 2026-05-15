import './assets/main.css'
import 'primeicons/primeicons.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'

import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user.js'

const app = createApp(App)

app.use(createPinia())
useUserStore().loadFromLocalStorage()
app.use(router)
app.use(PrimeVue, {
  theme: { preset: Aura },
})

app.mount('#app')

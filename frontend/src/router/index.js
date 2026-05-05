import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/onboarding',
      name: 'onboarding',
      component: () => import('../views/OnboardingView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/new',
      name: 'new-session',
      component: () => import('../views/NewSessionView.vue'),
    },
    {
      path: '/session/:id',
      name: 'session',
      component: () => import('../views/SessionView.vue'),
      props: true,
    },
    {
      path: '/session/:id/profile',
      name: 'session-profile',
      component: () => import('../views/ProfileView.vue'),
      props: true,
    },
  ],
})

export default router

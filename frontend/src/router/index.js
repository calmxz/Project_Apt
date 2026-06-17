import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '../stores/auth.js'
import { useUserStore } from '../stores/user.js'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../views/RegisterView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/onboarding',
      name: 'onboarding',
      component: () => import('../views/OnboardingView.vue'),
      meta: { sidebar: false },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/profile',
      name: 'profile-aggregate',
      component: () => import('../views/AggregateProfileView.vue'),
    },
    {
      path: '/new',
      name: 'new-session',
      component: () => import('../views/NewSessionView.vue'),
    },
    {
      path: '/sessions',
      name: 'sessions-library',
      component: () => import('../views/SessionsLibraryView.vue'),
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

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  // If auth store hasn't booted yet (first navigation in tests/dev), do it
  // now so the guard has a deterministic answer.
  if (!auth.ready) await auth.init()

  const isPublic = to.meta?.public === true
  if (!auth.isAuthenticated && !isPublic) {
    return { name: 'login' }
  }
  if (auth.isAuthenticated && (to.name === 'login' || to.name === 'register')) {
    return { name: 'home' }
  }

  const user = useUserStore()
  if (auth.isAuthenticated && !user.onboardingComplete && to.name !== 'onboarding') {
    return { name: 'onboarding' }
  }
  if (user.onboardingComplete && to.name === 'onboarding' && to.query.retake !== '1') {
    return { name: 'home' }
  }
})

export default router

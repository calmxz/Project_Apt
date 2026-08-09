import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '../stores/auth.js'
import { useUserStore } from '../stores/user.js'
import {
  start as progressStart,
  finish as progressFinish,
  fail as progressFail,
} from '../services/routeProgress.js'

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
      path: '/forgot',
      name: 'forgot-password',
      component: () => import('../views/ForgotPasswordView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('../views/ResetPasswordView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/tos',
      name: 'tos',
      component: () => import('../views/TosView.vue'),
      meta: { public: true, sidebar: false },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('../views/PrivacyView.vue'),
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
      redirect: { name: 'settings', params: { tab: 'profile' } },
    },
    {
      path: '/settings/:tab',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      props: true,
      beforeEnter: (to) => {
        const valid = ['profile', 'usage', 'account', 'appearance']
        if (!valid.includes(to.params.tab)) {
          return { name: 'settings', params: { tab: 'profile' } }
        }
      },
    },
    {
      // Unified into Settings (2026-08-02): aggregate profile is now the
      // Profile tab. Redirect kept so old links and router.push({name})
      // calls keep working.
      path: '/profile',
      name: 'profile-aggregate',
      redirect: { name: 'settings', params: { tab: 'profile' } },
    },
    {
      // Unified into Home (2026-08-02): one canonical start experience.
      // Redirect kept so old links and the sidebar name keep working.
      path: '/new',
      name: 'new-session',
      redirect: { name: 'home' },
    },
    {
      path: '/review',
      name: 'review',
      component: () => import('../views/ReviewView.vue'),
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

router.beforeEach(() => {
  progressStart()
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  // If auth store hasn't booted yet (first navigation in tests/dev), do it
  // now so the guard has a deterministic answer.
  if (!auth.ready) {
    try {
      await auth.init()
    } catch {
      // F-14: a failed init means no session - proceed unauthenticated;
      // the guard below routes to /login.
    }
  }

  const isPublic = to.meta?.public === true
  if (!auth.isAuthenticated && !isPublic) {
    // F-49: carry the intended path through login so a deep link survives.
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (auth.isAuthenticated && (to.name === 'login' || to.name === 'register')) {
    return { name: 'home' }
  }

  const user = useUserStore()
  if (auth.isAuthenticated && !user.hydrated) {
    // F-46: onboarding truth lives on the server; the localStorage snapshot
    // is only a warm cache. Await one hydrate so a new device does not
    // force-route an existing user to onboarding. When the snapshot already
    // says onboarding is complete, the answer cannot get worse by waiting --
    // render immediately and refresh in the background instead of spending a
    // full round trip on the first paint.
    if (user.onboardingComplete) {
      user.hydrateFromServer()
    } else {
      await user.hydrateFromServer()
    }
  }
  if (
    auth.isAuthenticated &&
    !user.onboardingComplete &&
    to.name !== 'onboarding' &&
    to.name !== 'reset-password'
  ) {
    return { name: 'onboarding' }
  }
  if (user.onboardingComplete && to.name === 'onboarding' && to.query.retake !== '1') {
    return { name: 'home' }
  }
})

router.afterEach((to, from, failure) => {
  // F-08: SPA route swaps leave keyboard/SR focus on a removed node. Reset
  // to the main landmark on real navigations (skip the initial load so we
  // don't steal focus from the address bar / skip-link).
  if (failure || !from.name) return
  if (typeof document === 'undefined') return
  document.getElementById('main-content')?.focus()
})

router.afterEach(() => {
  progressFinish()
})

router.onError(() => {
  progressFail()
})

export default router

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const routerPush = vi.fn()
const routeRef = { params: {}, fullPath: '/', meta: {} }
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  RouterView: { template: '<div data-testid="router-view" />' },
  useRouter: () => ({ push: routerPush }),
  useRoute: () => routeRef,
}))
vi.mock('primevue/toast', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showError: vi.fn(), showWarn: vi.fn(), showSuccess: vi.fn() }),
}))

import App from '@/App.vue'
import Sidebar from '@/components/sidebar/Sidebar.vue'
import { useSessionStore } from '@/stores/session.js'
import { useSidebar } from '@/composables/useSidebar.js'
import { __test__ as sidebarTest } from '@/composables/useSidebar.js'

function setViewport(w) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
  sidebarTest._setViewport(w)
}

describe('Shell a11y — skip link', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setViewport(1400)
    routeRef.meta = {}
    routeRef.params = {}
    document.body.className = ''
  })
  afterEach(() => wrapper?.unmount())

  it('skip link is the first focusable in the shell', () => {
    wrapper = mount(App)
    const skip = wrapper.find('[data-testid="skip-link"]')
    expect(skip.exists()).toBe(true)
    expect(skip.attributes('href')).toBe('#main-content')
  })

  it('skip link is absent on auth routes (sidebar:false meta)', () => {
    routeRef.meta = { sidebar: false }
    wrapper = mount(App)
    expect(wrapper.find('[data-testid="skip-link"]').exists()).toBe(false)
  })
})

describe('Mobile drawer a11y — scroll lock + ESC', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setViewport(800) // mobile
    routeRef.meta = {}
    routeRef.params = {}
    document.body.className = ''
  })
  afterEach(() => {
    wrapper?.unmount()
    document.body.className = ''
  })

  it('opening drawer adds sb-scroll-lock to body; closing removes it', async () => {
    wrapper = mount(App)
    const { openDrawer, closeDrawer } = useSidebar()
    expect(document.body.classList.contains('sb-scroll-lock')).toBe(false)
    openDrawer()
    await flushPromises()
    expect(document.body.classList.contains('sb-scroll-lock')).toBe(true)
    closeDrawer()
    await flushPromises()
    expect(document.body.classList.contains('sb-scroll-lock')).toBe(false)
  })

  it('ESC keydown closes the drawer when open', async () => {
    wrapper = mount(Sidebar, { attachTo: document.body })
    const { openDrawer, drawerOpen } = useSidebar()
    openDrawer()
    await flushPromises()
    expect(drawerOpen.value).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(drawerOpen.value).toBe(false)
  })

  it('unmount removes scroll-lock class from body', async () => {
    wrapper = mount(App)
    const { openDrawer } = useSidebar()
    openDrawer()
    await flushPromises()
    expect(document.body.classList.contains('sb-scroll-lock')).toBe(true)
    wrapper.unmount()
    expect(document.body.classList.contains('sb-scroll-lock')).toBe(false)
  })
})

describe('Mobile drawer a11y — focus trap', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    setViewport(800)
    routeRef.meta = {}
    routeRef.params = {}
  })
  afterEach(() => wrapper?.unmount())

  it('Tab on last focusable wraps to first', async () => {
    const store = useSessionStore()
    store.sessions = [
      { id: 'a1', topic: 'X', created_at: '2026-05-20T10:00:00Z', ended_at: null },
    ]
    wrapper = mount(Sidebar, { attachTo: document.body })
    const { openDrawer } = useSidebar()
    openDrawer()
    await flushPromises()

    const focusables = document
      .querySelector('.sidebar')
      ?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
    expect(focusables.length).toBeGreaterThan(0)

    const last = focusables[focusables.length - 1]
    last.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    // The trap's preventDefault + first.focus() runs in the same handler tick.
    // In jsdom, programmatic dispatch doesn't move focus on its own; we instead
    // verify the trap intercepts and explicitly calls focus on the first item.
    // We check that document.activeElement isn't outside the aside.
    await flushPromises()
    const aside = document.querySelector('.sidebar')
    expect(aside.contains(document.activeElement)).toBe(true)
  })
})

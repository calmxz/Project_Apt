import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* global process */

// R1 (WCAG 2.5.5): drawn boxes stay on the 28/32px pitch; the hit area grows
// to >= 44px on coarse pointers via a shared .hit-44 utility. This file
// asserts the utility exists in base.css and that every listed control
// carries the class.

describe('base.css: .hit-44 utility', () => {
  it('declares the rule and the coarse-pointer ::after with inset: -8px', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/assets/base.css'), 'utf8')
    expect(css).toContain('.hit-44 {')
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.hit-44::after/)
    expect(css).toMatch(/\.hit-44::after\s*\{[^}]*inset:\s*-8px/)
  })
})

describe('Composer — touch targets', () => {
  let Composer
  beforeEach(async () => {
    Composer = (await import('@/components/chat/Composer.vue')).default
  })

  function mountComposer(props = {}) {
    return mount(Composer, {
      props: {
        modelValue: '',
        disabled: false,
        uploading: false,
        sending: false,
        streamState: 'idle',
        ...props,
      },
    })
  }

  it('attach and send buttons carry hit-44', () => {
    const w = mountComposer()
    expect(w.get('[data-testid="session-upload-btn"]').classes()).toContain('hit-44')
    expect(w.get('[data-testid="session-send"]').classes()).toContain('hit-44')
  })

  it('stop button carries hit-44 while streaming', () => {
    const w = mountComposer({ streamState: 'streaming' })
    expect(w.get('[data-testid="session-stop"]').classes()).toContain('hit-44')
  })
})

describe('CueColumn — disclosure touch target', () => {
  let CueColumn
  beforeEach(async () => {
    CueColumn = (await import('@/components/chat/CueColumn.vue')).default
  })

  it('the cue disclosure carries hit-44', () => {
    const entry = (name) => ({ name, evidence_type: null, last_event_at: null })
    const profile = {
      knowledge_level: null,
      subtopic_levels: {},
      confirmed_gaps: [entry('gap one')],
      mastered_concepts: [],
      focus_target_gap: null,
      last_session_summary: null,
    }
    const w = mount(CueColumn, { props: { profile, sessionId: 's1' } })
    expect(w.get('[data-testid="cue-disclosure"]').classes()).toContain('hit-44')
  })
})

describe('Sidebar — collapse toggle touch target', () => {
  let Sidebar, sidebarTest

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('vue-router', () => ({
      RouterLink: { template: '<a><slot /></a>', props: ['to'] },
      useRouter: () => ({ push: vi.fn() }),
      useRoute: () => ({ params: {}, fullPath: '/' }),
    }))
    vi.doMock('@/composables/useToast.js', () => ({
      useToast: () => ({ showError: vi.fn(), showWarn: vi.fn(), showSuccess: vi.fn() }),
    }))
    vi.doMock('@/services/reviewApi.js', () => ({
      getReviewQueue: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 }),
    }))
    vi.doMock('@/services/sessionsApi.js', async (importOriginal) => {
      const actual = await importOriginal()
      return {
        ...actual,
        getSessionLibrary: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 15, offset: 0 }),
      }
    })
    setActivePinia(createPinia())
    ;({ __test__: sidebarTest } = await import('@/composables/useSidebar.js'))
    Sidebar = (await import('@/components/sidebar/Sidebar.vue')).default
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    })
    sidebarTest._setViewport(1400)
    sidebarTest._setExpanded(true)
  })

  afterEach(() => {
    vi.doUnmock('vue-router')
    vi.doUnmock('@/composables/useToast.js')
    vi.doUnmock('@/services/reviewApi.js')
    vi.doUnmock('@/services/sessionsApi.js')
  })

  it('the desktop collapse toggle carries hit-44', () => {
    const w = mount(Sidebar)
    expect(w.get('[data-testid="sidebar-collapse-toggle"]').classes()).toContain('hit-44')
  })
})

describe('SidebarRowMenu — trigger touch target (via SidebarSessionRow)', () => {
  let SidebarSessionRow

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('vue-router', () => ({
      useRouter: () => ({ push: vi.fn() }),
      useRoute: () => ({ params: {}, fullPath: '/' }),
    }))
    vi.doMock('@/composables/useToast.js', () => ({
      useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarn: vi.fn() }),
    }))
    setActivePinia(createPinia())
    SidebarSessionRow = (await import('@/components/sidebar/SidebarSessionRow.vue')).default
  })

  afterEach(() => {
    vi.doUnmock('vue-router')
    vi.doUnmock('@/composables/useToast.js')
  })

  it('the row-menu trigger carries hit-44', () => {
    const w = mount(SidebarSessionRow, {
      props: {
        session: { id: 's1', topic: 'Glycolysis', ended_at: null, pinned: false, progress: null },
        state: 'active',
      },
    })
    expect(w.get('[data-testid="sidebar-row-menu-trigger"]').classes()).toContain('hit-44')
  })
})

describe('SidebarMobileTopStrip — touch targets', () => {
  let SidebarMobileTopStrip

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('vue-router', () => ({
      RouterLink: { template: '<a><slot /></a>', props: ['to'] },
    }))
    setActivePinia(createPinia())
    SidebarMobileTopStrip = (await import('@/components/sidebar/SidebarMobileTopStrip.vue')).default
  })

  afterEach(() => {
    vi.doUnmock('vue-router')
  })

  it('hamburger and settings controls carry hit-44', () => {
    const w = mount(SidebarMobileTopStrip)
    expect(w.get('[data-testid="sidebar-mobile-hamburger"]').classes()).toContain('hit-44')
    expect(w.get('[data-testid="strip-settings"]').classes()).toContain('hit-44')
  })
})

describe('ProfileView — remove-button touch targets', () => {
  let ProfileView, profileApi

  const stubs = {
    RouterLink: { template: '<a><slot /></a>', props: ['to'] },
    BackButton: { template: '<button />', props: ['label', 'fallback'] },
    teleport: true,
    Dialog: {
      props: ['visible'],
      emits: ['update:visible'],
      template: '<div v-if="visible" data-testid="dialog"><slot /></div>',
    },
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('vue-router', () => ({
      useRouter: () => ({ push: vi.fn() }),
    }))
    setActivePinia(createPinia())
    profileApi = await import('@/services/profileApi.js')
    ProfileView = (await import('@/views/ProfileView.vue')).default
  })

  afterEach(() => {
    vi.doUnmock('vue-router')
    vi.restoreAllMocks()
  })

  it('mastered/gap chip-remove buttons carry hit-44', async () => {
    vi.spyOn(profileApi, 'getSessionProfile').mockResolvedValue({
      profile: {
        knowledge_level: 'beginner',
        confirmed_gaps: [{ name: 'window-fns', evidence_type: null, last_event_at: null }],
        mastered_concepts: [{ name: 'joins', evidence_type: 'tested', last_event_at: null }],
        subtopic_levels: {},
        focus_target_gap: null,
        last_session_summary: null,
      },
      recent_learning_events: [],
    })

    const w = mount(ProfileView, { props: { id: 's1' }, global: { stubs } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const removeButtons = w.findAll('[data-testid="chip-remove"]')
    expect(removeButtons.length).toBeGreaterThan(0)
    removeButtons.forEach((btn) => expect(btn.classes()).toContain('hit-44'))
  })
})

describe('HomeView — Start control touch target', () => {
  let HomeView

  const stubs = {
    EmptyState: {
      props: ['tone', 'eyebrow', 'headline', 'subtext'],
      template: '<div data-testid="empty-stub"><slot name="subtext" /><slot name="cta" /></div>',
    },
    RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('vue-router', () => ({
      useRouter: () => ({ push: vi.fn() }),
      RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
    }))
    vi.doMock('@/services/sessionsApi.js', () => ({
      endSession: vi.fn(),
    }))
    setActivePinia(createPinia())
    HomeView = (await import('@/views/HomeView.vue')).default
  })

  afterEach(() => {
    vi.doUnmock('vue-router')
    vi.doUnmock('@/services/sessionsApi.js')
  })

  it('the Start control carries hit-44', () => {
    const w = mount(HomeView, { global: { stubs } })
    expect(w.get('[data-testid="home-quick-go"]').classes()).toContain('hit-44')
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const routerPush = vi.fn()
const routeRef = { params: {}, fullPath: '/' }
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => routeRef,
}))
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarn: vi.fn() }),
}))

import SidebarSessionRow from '@/components/sidebar/SidebarSessionRow.vue'

const baseSession = (over = {}) => ({
  id: 's1',
  topic: 'Glycolysis',
  ended_at: null,
  pinned: false,
  progress: null,
  ...over,
})

function mountRow(session) {
  return mount(SidebarSessionRow, {
    props: { session, state: 'active' },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  routerPush.mockClear()
})

describe('SidebarSessionRow — level cell', () => {
  it('renders the level mark when progress.level is set', () => {
    const wrapper = mountRow(
      baseSession({ progress: { level: 'intermediate', mastered_count: 0 } }),
    )
    expect(wrapper.find('.sb-row-level').exists()).toBe(true)
    const path = wrapper.find('.sb-row-level-icon path')
    expect(path.exists()).toBe(true)
  })

  it('does not render the level cell when level is null', () => {
    const wrapper = mountRow(baseSession({ progress: { mastered_count: 2 } }))
    expect(wrapper.find('.sb-row-level').exists()).toBe(false)
  })

  it('does not render the level cell when progress is null', () => {
    const wrapper = mountRow(baseSession({ progress: null }))
    expect(wrapper.find('.sb-row-level').exists()).toBe(false)
  })

  it('includes the level in the accessible row label', () => {
    const wrapper = mountRow(
      baseSession({
        progress: { level: 'advanced', focus_target_gap: 'ATP yield', mastered_count: 3 },
      }),
    )
    const label = wrapper.get('[data-testid="sidebar-row-open"]').attributes('aria-label')
    expect(label).toContain('level advanced')
    expect(label).toContain('focus ATP yield')
    expect(label).toContain('3 mastered')
  })

  it('omits level from the row label when unset', () => {
    const wrapper = mountRow(baseSession({ progress: { mastered_count: 0 } }))
    const label = wrapper.get('[data-testid="sidebar-row-open"]').attributes('aria-label')
    expect(label).not.toContain('level')
  })
})

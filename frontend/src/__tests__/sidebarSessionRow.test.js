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

describe('SidebarSessionRow — accessible row label', () => {
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

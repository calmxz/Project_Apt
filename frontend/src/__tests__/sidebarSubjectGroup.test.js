import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {} }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ getSubject: vi.fn() }))
vi.mock('@/composables/useSidebar.js', () => ({ useSidebar: () => ({ mode: { value: 'expanded' }, closeDrawer: vi.fn() }) }))

import SidebarSubjectNode from '@/components/sidebar/SidebarSubjectNode.vue'
import { useSubjectStore } from '@/stores/subject.js'

const subject = { id: 's1', title: 'Organic Chemistry', progress: { done_count: 3, total_count: 6 } }

describe('SidebarSubjectNode', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows the title and n/m progress hint', () => {
    const wrapper = mount(SidebarSubjectNode, { props: { subject } })
    expect(wrapper.get('[data-testid="sidebar-subject-node-s1"]').text()).toContain('Organic Chemistry')
    expect(wrapper.get('[data-testid="sidebar-subject-progress-s1"]').text()).toContain('3/6')
  })

  it('expanding loads the subject and lists opened lesson rows', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => {
      store.currentSubject = { ...subject, lessons: [
        { id: 'l1', title: 'Bonding', status: 'done', session_id: 'sess1' },
        { id: 'l2', title: 'Alkanes', status: 'not_started', session_id: null },
      ] }
      return store.currentSubject
    })
    const wrapper = mount(SidebarSubjectNode, { props: { subject }, global: { stubs: { SidebarSessionRow: { props: ['session'], template: '<li class="row-stub">{{ session.topic }}</li>' } } } })
    await wrapper.get('[data-testid="sidebar-subject-toggle-s1"]').trigger('click')
    await flushPromises()
    expect(store.loadSubject).toHaveBeenCalledWith('s1')
    // only the opened lesson (session_id set) becomes a row
    expect(wrapper.findAll('.row-stub').length).toBe(1)
  })
})

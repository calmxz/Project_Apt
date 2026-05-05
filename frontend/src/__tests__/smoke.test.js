import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HomeView from '@/views/HomeView.vue'

describe('frontend smoke', () => {
  it('boots Vitest', () => {
    expect(1 + 1).toBe(2)
  })

  it('renders HomeView heading', () => {
    const wrapper = mount(HomeView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    expect(wrapper.text()).toContain('Sessions')
  })
})

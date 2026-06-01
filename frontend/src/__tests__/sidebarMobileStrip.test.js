import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
}))

import SidebarMobileTopStrip from '@/components/sidebar/SidebarMobileTopStrip.vue'

describe('SidebarMobileTopStrip', () => {
  let wrapper
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => wrapper?.unmount())

  it('renders the hamburger, logo, and profile link', () => {
    wrapper = mount(SidebarMobileTopStrip)
    expect(wrapper.find('[data-testid="sidebar-mobile-hamburger"]').exists()).toBe(true)
    expect(wrapper.find('.sb-strip-brand').exists()).toBe(true)
    expect(wrapper.find('[data-testid="strip-profile"]').exists()).toBe(true)
  })

  it('no longer renders theme or sign-out controls', () => {
    wrapper = mount(SidebarMobileTopStrip)
    expect(wrapper.find('[data-testid="strip-theme-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="strip-sign-out"]').exists()).toBe(false)
  })
})

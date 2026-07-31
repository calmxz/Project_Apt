import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import RouteProgressBar from '@/components/RouteProgressBar.vue'
import { routeProgress } from '@/services/routeProgress.js'

describe('RouteProgressBar', () => {
  beforeEach(() => {
    routeProgress.visible = false
    routeProgress.progress = 0
  })

  it('renders nothing while hidden', () => {
    const wrapper = mount(RouteProgressBar)
    expect(wrapper.find('[data-testid="route-progress"]').exists()).toBe(false)
  })

  it('renders with width bound to progress and aria-hidden', async () => {
    const wrapper = mount(RouteProgressBar)
    routeProgress.visible = true
    routeProgress.progress = 0.85
    await nextTick()
    const bar = wrapper.get('[data-testid="route-progress"]')
    expect(bar.attributes('aria-hidden')).toBe('true')
    expect(bar.get('.route-progress-bar').attributes('style')).toContain('width: 85%')
  })
})

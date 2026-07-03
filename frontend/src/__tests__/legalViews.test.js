import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PrivacyView from '../views/PrivacyView.vue'
import TosView from '../views/TosView.vue'

describe('legal views', () => {
  it('renders the ToS draft banner', () => {
    const wrapper = mount(TosView)
    expect(wrapper.text()).toContain('not legal advice')
  })

  it('renders the Privacy draft banner', () => {
    const wrapper = mount(PrivacyView)
    expect(wrapper.text()).toContain('not legal advice')
  })

  it('privacy policy names what is collected', () => {
    const wrapper = mount(PrivacyView)
    expect(wrapper.text().toLowerCase()).toContain('email')
  })
})

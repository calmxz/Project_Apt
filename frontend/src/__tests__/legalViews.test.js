import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PrivacyView from '../views/PrivacyView.vue'
import TosView from '../views/TosView.vue'

const stubs = {
  BackButton: {
    props: ['label', 'fallback'],
    template: '<a data-testid="back-button">{{ label }}</a>',
  },
}

describe('legal views', () => {
  it('ToS and Privacy render a back control above the article', () => {
    for (const View of [TosView, PrivacyView]) {
      const w = mount(View, { global: { stubs } })
      expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
      expect(w.find('article.legal').exists()).toBe(true)
    }
  })

  it('ToS and Privacy no longer carry the draft notice', () => {
    for (const View of [TosView, PrivacyView]) {
      const w = mount(View, { global: { stubs } })
      expect(w.text()).not.toContain('not legal advice')
      expect(w.text()).toMatch(/Version \d{4}-\d{2}-\d{2}/)
    }
  })

  it('privacy policy names what is collected', () => {
    const wrapper = mount(PrivacyView, { global: { stubs } })
    expect(wrapper.text().toLowerCase()).toContain('email')
  })
})

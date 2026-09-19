import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LegalView from '../views/LegalView.vue'

const stubs = {
  BackButton: {
    props: ['label', 'fallback'],
    template: '<a data-testid="back-button">{{ label }}</a>',
  },
}

function mountDoc(doc) {
  return mount(LegalView, { props: { doc }, global: { stubs } })
}

describe('legal views', () => {
  it('ToS and Privacy render a back control above the article', () => {
    for (const doc of ['tos', 'privacy']) {
      const w = mountDoc(doc)
      expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
      expect(w.find('article.legal').exists()).toBe(true)
    }
  })

  it('ToS and Privacy no longer carry the draft notice', () => {
    for (const doc of ['tos', 'privacy']) {
      const w = mountDoc(doc)
      expect(w.text()).not.toContain('not legal advice')
      expect(w.text()).toMatch(/Version \d{4}-\d{2}-\d{2}/)
    }
  })

  it('privacy policy names what is collected', () => {
    const wrapper = mountDoc('privacy')
    expect(wrapper.text().toLowerCase()).toContain('email')
  })
})

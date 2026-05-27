import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AssistantBubble from '../components/chat/AssistantBubble.vue'
import MarkdownContent from '../components/chat/MarkdownContent.vue'

describe('AssistantBubble', () => {
  it('renders markdown content (bold becomes <strong>)', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: '**bold**', tool_calls: [], citations: [] } },
    })
    expect(w.html()).toContain('<strong>bold</strong>')
  })

  it('renders tool-call chips with summary text', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: {
          content: '',
          tool_calls: [{ id: 't1', name: 'retrieve_chunks', state: 'done', summary: 'Found 5 passages' }],
          citations: [],
        },
      },
    })
    expect(w.text()).toContain('Found 5 passages')
  })

  it('renders citations with doc_name and page', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: {
          content: '',
          tool_calls: [],
          citations: [{ doc_id: 'd', doc_name: 'Doc', page: 1 }],
        },
      },
    })
    expect(w.text()).toContain('Doc')
    expect(w.text()).toContain('p.1')
  })

  it('shows cancelled marker when status is cancelled', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: { content: 'partial', tool_calls: [], citations: [], status: 'cancelled' },
      },
    })
    expect(w.text()).toMatch(/stopped/i)
    expect(w.find('.cancelled-marker').exists()).toBe(true)
  })

  it('does not show cancelled marker when status is complete', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: { content: 'full answer', tool_calls: [], citations: [], status: 'complete' },
      },
    })
    expect(w.find('.cancelled-marker').exists()).toBe(false)
  })

  it('streaming=true: MarkdownContent receives streaming=true, testid is msg-streaming', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: { content: 'hello', tool_calls: [], citations: [] },
        streaming: true,
      },
    })
    expect(w.findComponent(MarkdownContent).props('streaming')).toBe(true)
    expect(w.attributes('data-testid')).toBe('msg-streaming')
    expect(w.classes()).toContain('streaming')
  })

  it('streaming=false: MarkdownContent receives streaming=false, testid is msg-assistant', () => {
    const w = mount(AssistantBubble, {
      props: {
        message: { content: 'hello', tool_calls: [], citations: [] },
        streaming: false,
      },
    })
    expect(w.findComponent(MarkdownContent).props('streaming')).toBe(false)
    expect(w.attributes('data-testid')).toBe('msg-assistant')
    expect(w.classes()).not.toContain('streaming')
  })

  it('root element has classes msg and assistant', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: 'test', tool_calls: [], citations: [] } },
    })
    expect(w.classes()).toContain('msg')
    expect(w.classes()).toContain('assistant')
  })

  it('role-tag reads "tutor"', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: 'test', tool_calls: [], citations: [] } },
    })
    expect(w.find('.role-tag').text()).toBe('tutor')
  })

  it('renders without tool_calls or citations fields (guards against missing props)', () => {
    const w = mount(AssistantBubble, {
      props: { message: { content: 'safe' } },
    })
    expect(w.exists()).toBe(true)
    expect(w.text()).toContain('safe')
  })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageList from '../components/chat/MessageList.vue'
import UserBubble from '../components/chat/UserBubble.vue'
import AssistantBubble from '../components/chat/AssistantBubble.vue'

const userMsg = { message_id: 'u1', role: 'user', content: 'q' }
const assistantMsg = {
  message_id: 'a1',
  role: 'assistant',
  content: 'a',
  tool_calls: [],
  citations: [],
  status: 'complete',
}
const streamingMsg = {
  role: 'assistant',
  content: 'stream',
  tool_calls: [],
  citations: [],
}

describe('MessageList', () => {
  it('renders user and assistant messages in order', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg, assistantMsg] },
    })
    expect(w.findAllComponents(UserBubble)).toHaveLength(1)
    expect(w.findAllComponents(AssistantBubble)).toHaveLength(1)
    expect(w.findAllComponents(AssistantBubble)[0].props('streaming')).toBe(false)
  })

  // U-01: assistant rows with nothing renderable (no content, no batch, no
  // tool calls, no citations, not cancelled/partial) painted empty bubbles.
  it('skips assistant messages with nothing to render (U-01)', () => {
    const empty = {
      message_id: 'a-empty', role: 'assistant', content: '',
      tool_calls: [], citations: [], status: 'complete', check_batch: null,
    }
    const w = mount(MessageList, {
      props: { messages: [userMsg, empty, assistantMsg] },
    })
    expect(w.findAllComponents(AssistantBubble)).toHaveLength(1)
    expect(w.findAllComponents(UserBubble)).toHaveLength(1)
  })

  it('keeps empty-content assistant rows that carry a marker or attachments (U-01)', () => {
    const cancelled = {
      message_id: 'a-c', role: 'assistant', content: '',
      tool_calls: [], citations: [], status: 'cancelled',
    }
    const recap = {
      message_id: 'a-r', role: 'assistant', content: '',
      tool_calls: [], citations: [], status: 'complete',
      check_batch: { gap: 'g', total: 1, items: [] },
    }
    const w = mount(MessageList, {
      props: { messages: [cancelled, recap] },
    })
    expect(w.findAllComponents(AssistantBubble)).toHaveLength(2)
  })

  it('streamingMessage renders an extra AssistantBubble with streaming===true', () => {
    const w = mount(MessageList, {
      props: {
        messages: [userMsg, assistantMsg],
        streamingMessage: streamingMsg,
      },
    })
    const bubbles = w.findAllComponents(AssistantBubble)
    // one for the regular assistant msg, one for streaming
    expect(bubbles).toHaveLength(2)
    const streamingBubble = bubbles.find((b) => b.props('streaming') === true)
    expect(streamingBubble).toBeDefined()
    expect(w.find('[data-testid="msg-streaming"]').exists()).toBe(true)
  })

  it('typing indicator shows when awaiting=true and no streamingMessage', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg], awaiting: true },
    })
    expect(w.find('[data-testid="msg-typing"]').exists()).toBe(true)
  })

  it('typing indicator NOT shown when awaiting=false', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg], awaiting: false },
    })
    expect(w.find('[data-testid="msg-typing"]').exists()).toBe(false)
  })

  it('typing indicator NOT shown when streamingMessage is set (even if awaiting=true)', () => {
    const w = mount(MessageList, {
      props: {
        messages: [userMsg],
        streamingMessage: streamingMsg,
        awaiting: true,
      },
    })
    expect(w.find('[data-testid="msg-typing"]').exists()).toBe(false)
  })

  it('idle state: no msg-typing and no msg-streaming', () => {
    const w = mount(MessageList, {
      props: { messages: [userMsg, assistantMsg], awaiting: false },
    })
    expect(w.find('[data-testid="msg-typing"]').exists()).toBe(false)
    expect(w.find('[data-testid="msg-streaming"]').exists()).toBe(false)
  })

  it('.message-list is a polite, non-atomic live region', () => {
    const w = mount(MessageList, { props: { messages: [userMsg] } })
    const list = w.find('.message-list')
    expect(list.attributes('aria-live')).toBe('polite')
    expect(list.attributes('aria-atomic')).toBe('false')
  })
})

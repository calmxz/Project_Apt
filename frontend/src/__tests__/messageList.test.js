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
})

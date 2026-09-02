import { describe, expect, it } from 'vitest'
import { conversationKey, summarizeTurn, toSessionId } from '../src/conversation.ts'

describe('conversation identity', () => {
  it('separates chat threads while keeping ordinary replies in the chat session', () => {
    const base = { chatId: 'oc_1', chatType: 'group' as const }
    expect(conversationKey(base)).toBe('chat:oc_1')
    expect(conversationKey({ ...base, threadId: 'omt_1' })).toBe('thread:oc_1:omt_1')
    expect(conversationKey({ ...base, replyToMessageId: 'om_1' })).toBe('chat:oc_1')
  })

  it('creates deterministic opaque bounded session ids per domain', () => {
    const a = toSessionId('feishu', 'chat:oc_secret')
    expect(a).toBe(toSessionId('feishu', 'chat:oc_secret'))
    expect(a).not.toContain('oc_secret')
    expect(a).not.toBe(toSessionId('lark', 'chat:oc_secret'))
    expect(a.length).toBeLessThanOrEqual(64)
  })
})

describe('summarizeTurn', () => {
  it('returns the last assistant text after the turn boundary', () => {
    const events = [
      { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'old' }] } } },
      { seq: 2, type: 'turn/start', data: {} },
      { seq: 3, type: 'tool/call', data: { name: 'teamcity_query' } },
      { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'new ' }, { type: 'text', text: 'answer' }] } } },
      { seq: 5, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]
    expect(summarizeTurn(events, 2)).toEqual({ text: 'new answer', ok: true, toolCalls: 1 })
  })

  it('reports a failed or empty turn without exposing its internal error', () => {
    expect(summarizeTurn([
      { seq: 4, type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'secret' } } } },
    ], 4)).toEqual({ text: '', ok: false, toolCalls: 0 })
  })
})

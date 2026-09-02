import { createHash } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { DomainName } from './config.ts'

export interface ConversationMessage {
  chatId: string
  chatType: 'p2p' | 'group'
  threadId?: string
  replyToMessageId?: string
}

export function conversationKey(message: ConversationMessage): string {
  return message.threadId === undefined
    ? `chat:${message.chatId}`
    : `thread:${message.chatId}:${message.threadId}`
}

export function toSessionId(domain: DomainName, key: string): SessionId {
  const digest = createHash('sha256').update(`${domain}\0${key}`).digest('hex').slice(0, 40)
  // v2 sessions include the Harness workspace and agent-preset composition.
  // Keep them separate from sessions created by releases that lacked it.
  return SessionId(`lark-v2-${digest}`)
}

interface EventLike {
  seq: number
  type: string
  data: Record<string, unknown>
}

export interface TurnSummary { text: string; ok: boolean; toolCalls: number }

export function summarizeTurn(events: readonly EventLike[], firstSeq: number): TurnSummary {
  let text = ''
  let completed = false
  let failed = false
  let toolCalls = 0
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'assistant/message') {
      const message = event.data.message as { content?: Array<{ type: string; text?: string }> } | undefined
      const next = message?.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? ''
      if (next !== '') text = next
    }
    if (event.type === 'tool/call') toolCalls += 1
    if (event.type === 'turn/end') {
      const reason = event.data.reason as { kind?: string } | undefined
      completed = reason?.kind === 'completed'
      failed = reason?.kind === 'error' || reason?.kind === 'cancelled'
    }
  }
  return { text, ok: completed && !failed && text !== '', toolCalls }
}

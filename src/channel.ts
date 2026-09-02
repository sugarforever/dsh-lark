import { Domain, LoggerLevel, createLarkChannel } from '@larksuiteoapi/node-sdk'
import type { LarkChannel, LarkChannelOptions, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { RuntimeConfig } from './config.ts'
import type { HarnessConversationService } from './harness.ts'

export type ChannelFactory = (options: LarkChannelOptions) => LarkChannel
export interface PluginLogger {
  info(message: string): unknown
  warn(message: string): unknown
  error(message: string): unknown
}

export async function startChannel(
  config: Omit<RuntimeConfig, 'appSecretRef'>,
  bridge: Pick<HarnessConversationService, 'reply' | 'dispose'> & Partial<Pick<HarnessConversationService, 'replyWithMetrics'>>,
  factory: ChannelFactory = createLarkChannel,
  logger: PluginLogger = console,
  terminalLogger?: Pick<PluginLogger, 'error'>,
): Promise<() => Promise<void>> {
  const logError = (message: string) => {
    logger.error(message)
    terminalLogger?.error(message)
  }
  const channel = factory({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    domain: config.domain === 'lark' ? Domain.Lark : Domain.Feishu,
    source: 'dsh-lark',
    loggerLevel: LoggerLevel.info,
    handshakeTimeoutMs: 15_000,
    policy: {
      requireMention: config.requireMention,
      dmMode: config.dmMode,
      groupAllowlist: config.groupAllowlist,
      dmAllowlist: config.dmAllowlist,
      respondToMentionAll: false,
    },
    safety: {
      chatQueue: { enabled: true },
      staleMessageWindowMs: 5 * 60_000,
      dedup: { ttl: 10 * 60_000, maxEntries: 10_000 },
    },
  })

  const unsubscribers = [
    channel.on('message', async (message: NormalizedMessage) => {
      const startedAt = performance.now()
      const replyInThread = message.threadId !== undefined
      let reactionId: string | undefined
      let reactionStatus = config.typingReaction === undefined ? 'disabled' : 'pending'
      let ackMs = 0
      let agentMs = 0
      let agentSettled = false
      let sendMs = 0
      let toolCalls: number | undefined
      let outcome = 'failed'
      if (config.typingReaction !== undefined) {
        const ackStartedAt = performance.now()
        try {
          reactionId = await channel.addReaction(message.messageId, config.typingReaction)
          reactionStatus = 'added'
        } catch {
          reactionStatus = 'error'
          logger.warn('dsh-lark: typing reaction add failed')
        } finally {
          ackMs = performance.now() - ackStartedAt
        }
      }
      const agentStartedAt = performance.now()
      try {
        const reply = bridge.replyWithMetrics === undefined
          ? { text: await bridge.reply(message), toolCalls: undefined }
          : await bridge.replyWithMetrics(message)
        agentMs = performance.now() - agentStartedAt
        agentSettled = true
        toolCalls = reply.toolCalls
        const sendStartedAt = performance.now()
        await channel.send(message.chatId, { markdown: reply.text }, {
          replyTo: message.messageId,
          replyInThread,
        })
        sendMs = performance.now() - sendStartedAt
        outcome = 'success'
      } catch (error: unknown) {
        if (!agentSettled) agentMs = performance.now() - agentStartedAt
        logError(`dsh-lark: message handling failed: ${error instanceof Error ? error.message : String(error)}`)
        const sendStartedAt = performance.now()
        await channel.send(message.chatId, { text: config.errorMessage }, {
          replyTo: message.messageId,
          replyInThread,
        }).then(() => {
          outcome = 'fallback'
        }).catch((sendError: unknown) => {
          logError(`dsh-lark: fallback reply failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`)
        }).finally(() => {
          sendMs += performance.now() - sendStartedAt
        })
      } finally {
        const repliedAt = performance.now()
        if (reactionId !== undefined) {
          await channel.removeReaction(message.messageId, reactionId).catch(() => {
            logger.warn('dsh-lark: typing reaction removal failed')
          })
        }
        logger.info(`dsh-lark: message metrics ${JSON.stringify({
          ack_ms: Math.round(ackMs),
          agent_ms: Math.round(agentMs),
          send_ms: Math.round(sendMs),
          total_ms: Math.round(repliedAt - startedAt),
          tool_calls: toolCalls ?? null,
          outcome,
          typing_reaction: reactionStatus,
        })}`)
      }
    }),
    channel.on('reconnecting', () => { logger.warn('dsh-lark: WebSocket reconnecting') }),
    channel.on('reconnected', () => { logger.info('dsh-lark: WebSocket reconnected') }),
    channel.on('error', (error) => { logError(`dsh-lark: channel error: ${String(error)}`) }),
  ]
  try {
    await channel.connect()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const redacted = config.appSecret === '' ? detail : detail.split(config.appSecret).join('[redacted]')
    logError(`dsh-lark: WebSocket connection failed: ${redacted}`)
    for (const unsubscribe of unsubscribers) unsubscribe()
    await bridge.dispose()
    throw error
  }
  logger.info('dsh-lark: WebSocket connected')

  return async () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
    try {
      await channel.disconnect()
      logger.info('dsh-lark: WebSocket disconnected')
    } finally {
      await bridge.dispose()
    }
  }
}

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
  bridge: Pick<HarnessConversationService, 'reply' | 'dispose'>,
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
      const replyInThread = message.threadId !== undefined

      // Transient "processing" reaction — mirrors the Hermes Feishu adapter.
      // Feishu exposes no typing API, so the "正在输入" signal is a reaction
      // badge ("Typing") added to the inbound message, removed once the reply
      // lands, and replaced by a "CrossMark" badge when the turn fails.
      // Best-effort: a missing message-reaction permission only logs a warning
      // and never blocks the reply itself.
      let processingReactionId: string | null = null
      const clearProcessingReaction = async () => {
        const id = processingReactionId
        processingReactionId = null
        if (id && message.messageId) {
          await channel.removeReaction(message.messageId, id).catch((error: unknown) => {
            logError(`dsh-lark: processing reaction remove failed (best-effort): ${error instanceof Error ? error.message : String(error)}`)
          })
        }
      }
      if (config.processingReactions && message.messageId) {
        try {
          processingReactionId = (await channel.addReaction(message.messageId, 'Typing')) ?? null
        } catch (error: unknown) {
          logError(`dsh-lark: processing reaction add failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      try {
        const text = await bridge.reply(message)
        await clearProcessingReaction()
        await channel.send(message.chatId, { markdown: text }, {
          replyTo: message.messageId,
          replyInThread,
        })
      } catch (error: unknown) {
        await clearProcessingReaction()
        logError(`dsh-lark: message handling failed: ${error instanceof Error ? error.message : String(error)}`)
        if (config.processingReactions && message.messageId) {
          await channel.addReaction(message.messageId, 'CrossMark').catch((reactionError: unknown) => {
            logError(`dsh-lark: failure reaction add failed (best-effort): ${reactionError instanceof Error ? reactionError.message : String(reactionError)}`)
          })
        }
        await channel.send(message.chatId, { text: config.errorMessage }, {
          replyTo: message.messageId,
          replyInThread,
        }).catch((sendError: unknown) => {
          logError(`dsh-lark: fallback reply failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`)
        })
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

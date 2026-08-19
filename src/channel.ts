import { Domain, LoggerLevel, createLarkChannel } from '@larksuiteoapi/node-sdk'
import type { CardActionEvent, LarkChannel, LarkChannelOptions, NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { RuntimeConfig } from './config.ts'
import type { HarnessConversationService } from './harness.ts'
import {
  buildWorkspaceCard,
  parseWorkspaceCommand,
  workspaceAddedText,
  workspaceHelpText,
  workspaceListText,
  workspaceSwitchedText,
} from './workspace-command.ts'
import type { WorkspaceCommand } from './workspace-command.ts'
import type { ConversationMessage } from './conversation.ts'

export type ChannelFactory = (options: LarkChannelOptions) => LarkChannel
export interface PluginLogger {
  info(message: string): unknown
  warn(message: string): unknown
  error(message: string): unknown
}

type HarnessBridge = Pick<HarnessConversationService,
  'reply' | 'dispose' | 'workspaceList' | 'workspaceCurrent' | 'workspaceAdd' | 'workspaceSwitch'>

export async function startChannel(
  config: Omit<RuntimeConfig, 'appSecretRef'>,
  bridge: HarnessBridge,
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

  const conversation = (message: NormalizedMessage): ConversationMessage => {
    const chat: ConversationMessage = { chatId: message.chatId, chatType: message.chatType }
    if (message.threadId !== undefined) chat.threadId = message.threadId
    return chat
  }

  /** Execute a `/workspace` command. Returns markdown to send, or `null` when the card was already sent. */
  const runWorkspaceCommand = async (command: WorkspaceCommand, message: NormalizedMessage): Promise<string | null> => {
    const chat = conversation(message)
    switch (command.kind) {
      case 'list': {
        const current = await bridge.workspaceCurrent(chat)
        if (config.enableCardPicker) {
          const workspaces = await bridge.workspaceList()
          await channel.send(message.chatId, { card: buildWorkspaceCard(workspaces, current?.path) }, {
            replyTo: message.messageId,
            replyInThread: message.threadId !== undefined,
          })
          return null
        }
        return workspaceListText(await bridge.workspaceList(), current?.path)
      }
      case 'add': {
        const workspace = await bridge.workspaceAdd(command.path)
        return workspaceAddedText(workspace)
      }
      case 'switch': {
        const workspace = await bridge.workspaceSwitch(chat, command.selector)
        return workspaceSwitchedText(workspace)
      }
      case 'help':
        return workspaceHelpText()
      default: {
        const _exhaustive: never = command
        throw new Error(`unhandled workspace command: ${String(_exhaustive)}`)
      }
    }
  }

  const unsubscribers = [
    channel.on('message', async (message: NormalizedMessage) => {
      const replyInThread = message.threadId !== undefined
      try {
        const command = parseWorkspaceCommand(message.content)
        if (command !== undefined) {
          const text = await runWorkspaceCommand(command, message)
          if (text !== null) {
            await channel.send(message.chatId, { markdown: text }, {
              replyTo: message.messageId,
              replyInThread,
            })
          }
          return
        }
        const text = await bridge.reply(message)
        await channel.send(message.chatId, { markdown: text }, {
          replyTo: message.messageId,
          replyInThread,
        })
      } catch (error: unknown) {
        logError(`dsh-lark: message handling failed: ${error instanceof Error ? error.message : String(error)}`)
        await channel.send(message.chatId, { text: config.errorMessage }, {
          replyTo: message.messageId,
          replyInThread,
        }).catch((sendError: unknown) => {
          logError(`dsh-lark: fallback reply failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`)
        })
      }
    }),
    channel.on('cardAction', async (event: CardActionEvent) => {
      const value = event.action?.value
      if (typeof value !== 'object' || value === null) return
      const payload = value as Record<string, unknown>
      if (payload.action !== 'switch-workspace' || typeof payload.path !== 'string') return
      try {
        const workspace = await bridge.workspaceSwitch({ chatId: event.chatId, chatType: 'p2p' }, payload.path)
        await channel.send(event.chatId, { markdown: workspaceSwitchedText(workspace) })
      } catch (error: unknown) {
        logError(`dsh-lark: card workspace switch failed: ${error instanceof Error ? error.message : String(error)}`)
        await channel.send(event.chatId, { text: '切换失败：' + (error instanceof Error ? error.message : String(error)) }).catch(() => undefined)
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

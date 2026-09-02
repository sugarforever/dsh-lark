import { describe, expect, it, vi } from 'vitest'
import { startChannel } from '../src/channel.ts'

function fakeChannel() {
  const handlers = new Map<string, Function>()
  return {
    handlers,
    connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined),
    send: vi.fn(async () => ({ messageId: 'out' })),
    addReaction: vi.fn(async () => 'reaction-1'),
    removeReaction: vi.fn(async () => undefined),
    on: vi.fn((name: string, handler: Function) => { handlers.set(name, handler); return () => handlers.delete(name) }),
  }
}

describe('startChannel', () => {
  it('uses WebSocket policy defaults and replies to the inbound message', async () => {
    const channel = fakeChannel()
    const factory = vi.fn(() => channel as any)
    const bridge = { reply: vi.fn(async () => 'Hello **Lark**'), dispose: vi.fn(async () => undefined) }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const stop = await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
    }, bridge, factory, logger)
    expect(logger.info).toHaveBeenCalledWith('dsh-lark: WebSocket connected')
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ transport: 'websocket', policy: expect.objectContaining({ requireMention: true, dmMode: 'open' }) }))
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: 'hi' })
    expect(bridge.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'hi' }))
    expect(channel.send).toHaveBeenCalledWith('oc_1', { markdown: 'Hello **Lark**' }, { replyTo: 'om_1', replyInThread: false })
    await stop()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(bridge.dispose).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith('dsh-lark: WebSocket disconnected')
  })

  it('sends a safe fallback when the Harness turn fails', async () => {
    const channel = fakeChannel()
    const bridge = { reply: vi.fn(async () => { throw new Error('secret stack') }), dispose: vi.fn(async () => undefined) }
    const terminal = { error: vi.fn() }
    await startChannel({ appId: 'id', appSecret: 'secret', domain: 'lark', requireMention: true, dmMode: 'open', groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error' }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, terminal)
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'group', threadId: 'omt_1', content: 'hi' })
    expect(terminal.error).toHaveBeenCalledWith('dsh-lark: message handling failed: secret stack')
    expect(channel.send).toHaveBeenCalledWith('oc_1', { text: 'safe error' }, { replyTo: 'om_1', replyInThread: true })
  })

  it('adds one typing reaction, replies with metrics, and removes its own reaction afterwards', async () => {
    const channel = fakeChannel()
    const bridge = {
      reply: vi.fn(async () => 'unused'),
      replyWithMetrics: vi.fn(async () => ({ text: 'answer', toolCalls: 2 })),
      dispose: vi.fn(async () => undefined),
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error', typingReaction: 'Typing',
    }, bridge, () => channel as any, logger)

    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: 'private prompt' })

    expect(channel.addReaction).toHaveBeenCalledOnce()
    expect(channel.addReaction).toHaveBeenCalledWith('om_1', 'Typing')
    expect(channel.send).toHaveBeenCalledWith('oc_1', { markdown: 'answer' }, { replyTo: 'om_1', replyInThread: false })
    expect(channel.removeReaction).toHaveBeenCalledWith('om_1', 'reaction-1')
    expect(channel.addReaction.mock.invocationCallOrder[0]).toBeLessThan(bridge.replyWithMetrics.mock.invocationCallOrder[0]!)
    expect(channel.send.mock.invocationCallOrder[0]).toBeLessThan(channel.removeReaction.mock.invocationCallOrder[0]!)
    const metrics = logger.info.mock.calls.map(call => String(call[0])).find(line => line.startsWith('dsh-lark: message metrics '))!
    expect(metrics).toContain('"tool_calls":2')
    expect(metrics).toContain('"outcome":"success"')
    expect(metrics).not.toContain('private prompt')
    expect(metrics).not.toContain('om_1')
  })

  it('keeps replies working when typing reactions fail to add or remove', async () => {
    const addFailure = fakeChannel()
    addFailure.addReaction.mockRejectedValueOnce(new Error('permission denied'))
    const addLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error', typingReaction: 'Typing',
    }, { reply: async () => 'answer', dispose: async () => undefined }, () => addFailure as any, addLogger)
    await addFailure.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: 'hi' })
    expect(addFailure.send).toHaveBeenCalledWith('oc_1', { markdown: 'answer' }, expect.any(Object))
    expect(addLogger.warn).toHaveBeenCalledWith('dsh-lark: typing reaction add failed')

    const removeFailure = fakeChannel()
    removeFailure.removeReaction.mockRejectedValueOnce(new Error('network failed'))
    const removeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error', typingReaction: 'Typing',
    }, { reply: async () => 'answer', dispose: async () => undefined }, () => removeFailure as any, removeLogger)
    await removeFailure.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: 'hi' })
    expect(removeLogger.warn).toHaveBeenCalledWith('dsh-lark: typing reaction removal failed')
  })

  it('removes the typing reaction after sending a safe fallback', async () => {
    const channel = fakeChannel()
    const bridge = { reply: vi.fn(async () => { throw new Error('turn failed') }), dispose: vi.fn(async () => undefined) }
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error', typingReaction: 'Typing',
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: 'hi' })
    expect(channel.send).toHaveBeenCalledWith('oc_1', { text: 'safe error' }, expect.any(Object))
    expect(channel.removeReaction).toHaveBeenCalledWith('om_1', 'reaction-1')
  })

  it('cleans up typing after a primary send failure and fallback attempt', async () => {
    const channel = fakeChannel()
    channel.send.mockRejectedValueOnce(new Error('primary send failed'))
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error', typingReaction: 'Typing',
    }, { reply: async () => 'answer', dispose: async () => undefined }, () => channel as any, logger)

    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: 'hi' })

    expect(channel.send).toHaveBeenCalledTimes(2)
    expect(channel.send).toHaveBeenLastCalledWith('oc_1', { text: 'safe error' }, expect.any(Object))
    expect(channel.removeReaction).toHaveBeenCalledWith('om_1', 'reaction-1')
    const metrics = logger.info.mock.calls.map(call => String(call[0])).find(line => line.startsWith('dsh-lark: message metrics '))!
    expect(metrics).toContain('"outcome":"fallback"')
  })

  it('disposes conversation resources when channel disconnect fails', async () => {
    const channel = fakeChannel()
    channel.disconnect.mockRejectedValueOnce(new Error('disconnect failed'))
    const bridge = { reply: vi.fn(async () => ''), dispose: vi.fn(async () => undefined) }
    const stop = await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'lark', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await expect(stop()).rejects.toThrow('disconnect failed')
    expect(bridge.dispose).toHaveBeenCalledOnce()
  })

  it('logs an initial connection failure to the Harness logger and terminal without exposing the secret', async () => {
    const channel = fakeChannel()
    channel.connect.mockRejectedValueOnce(new Error('authentication failed for secret'))
    const bridge = { reply: vi.fn(async () => ''), dispose: vi.fn(async () => undefined) }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const terminal = { error: vi.fn() }

    await expect(startChannel({
      appId: 'id', appSecret: 'secret', domain: 'lark', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
    }, bridge, () => channel as any, logger, terminal)).rejects.toThrow('authentication failed for secret')

    expect(logger.error).toHaveBeenCalledWith('dsh-lark: WebSocket connection failed: authentication failed for [redacted]')
    expect(terminal.error).toHaveBeenCalledWith('dsh-lark: WebSocket connection failed: authentication failed for [redacted]')
    expect(bridge.dispose).toHaveBeenCalledOnce()
  })
})

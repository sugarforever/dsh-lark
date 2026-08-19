import { describe, expect, it, vi } from 'vitest'
import { startChannel } from '../src/channel.ts'
import type { WorkspaceSummary } from '../src/workspace-command.ts'

function fakeChannel() {
  const handlers = new Map<string, Function>()
  return {
    handlers,
    connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined),
    send: vi.fn(async () => ({ messageId: 'out' })),
    on: vi.fn((name: string, handler: Function) => { handlers.set(name, handler); return () => handlers.delete(name) }),
  }
}

function fakeBridge(reply: (...args: any[]) => Promise<string> = async () => 'ok', dispose: () => Promise<void> = async () => undefined) {
  return {
    reply: vi.fn(reply),
    dispose: vi.fn(dispose),
    workspaceList: vi.fn(async (): Promise<WorkspaceSummary[]> => []),
    workspaceCurrent: vi.fn(async (): Promise<WorkspaceSummary | undefined> => undefined),
    workspaceAdd: vi.fn(async (_path: string): Promise<WorkspaceSummary> => ({ path: '/added', title: 'added' })),
    workspaceSwitch: vi.fn(async (_conversation: any, _selector: string): Promise<WorkspaceSummary> => ({ path: '/switched', title: 'switched' })),
  }
}

describe('startChannel', () => {
  it('uses WebSocket policy defaults and replies to the inbound message', async () => {
    const channel = fakeChannel()
    const factory = vi.fn(() => channel as any)
    const bridge = fakeBridge(async () => 'Hello **Lark**')
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
    const bridge = fakeBridge(async () => { throw new Error('secret stack') })
    const terminal = { error: vi.fn() }
    await startChannel({ appId: 'id', appSecret: 'secret', domain: 'lark', requireMention: true, dmMode: 'open', groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error' }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, terminal)
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'group', threadId: 'omt_1', content: 'hi' })
    expect(terminal.error).toHaveBeenCalledWith('dsh-lark: message handling failed: secret stack')
    expect(channel.send).toHaveBeenCalledWith('oc_1', { text: 'safe error' }, { replyTo: 'om_1', replyInThread: true })
  })

  it('disposes conversation resources when channel disconnect fails', async () => {
    const channel = fakeChannel()
    channel.disconnect.mockRejectedValueOnce(new Error('disconnect failed'))
    const bridge = fakeBridge(async () => '')
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
    const bridge = fakeBridge(async () => '')
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
  it('handles the /workspace list command without invoking the agent', async () => {
    const channel = fakeChannel()
    const bridge = fakeBridge()
    bridge.workspaceList.mockResolvedValueOnce([{ path: '/projects/a', title: 'A' }])
    bridge.workspaceCurrent.mockResolvedValueOnce({ path: '/projects/a', title: 'A' })
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: '/workspace' })

    expect(bridge.reply).not.toHaveBeenCalled()
    expect(channel.send).toHaveBeenCalledWith('oc_1', expect.objectContaining({ markdown: expect.stringContaining('▸ **A**') }), expect.anything())
  })

  it('sends an interactive picker card on /workspace when enableCardPicker is on', async () => {
    const channel = fakeChannel()
    const bridge = fakeBridge()
    bridge.workspaceList.mockResolvedValueOnce([{ path: '/projects/a', title: 'A' }])
    bridge.workspaceCurrent.mockResolvedValueOnce({ path: '/projects/a', title: 'A' })
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
      enableCardPicker: true,
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: '/workspace' })

    expect(bridge.reply).not.toHaveBeenCalled()
    expect(channel.send).toHaveBeenCalledWith('oc_1', expect.objectContaining({ card: expect.objectContaining({ header: expect.objectContaining({ title: expect.objectContaining({ content: '切换工作目录' }) }) }) }), expect.anything())
  })

  it('registers a new workspace via /workspace add', async () => {
    const channel = fakeChannel()
    const bridge = fakeBridge()
    bridge.workspaceAdd.mockResolvedValueOnce({ path: '/new/dir', title: 'dir' })
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await channel.handlers.get('message')!({ messageId: 'om_1', chatId: 'oc_1', chatType: 'p2p', content: '/workspace add /new/dir' })

    expect(bridge.workspaceAdd).toHaveBeenCalledWith('/new/dir')
    expect(bridge.reply).not.toHaveBeenCalled()
    expect(channel.send).toHaveBeenCalledWith('oc_1', expect.objectContaining({ markdown: expect.stringContaining('已登记 workspace') }), expect.anything())
  })

  it('switches a workspace from a card button click', async () => {
    const channel = fakeChannel()
    const bridge = fakeBridge()
    bridge.workspaceSwitch.mockResolvedValueOnce({ path: '/projects/b', title: 'B' })
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
      enableCardPicker: true,
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await channel.handlers.get('cardAction')!({
      messageId: 'om_9', chatId: 'oc_1',
      operator: { openId: 'ou_1' },
      action: { value: { action: 'switch-workspace', path: '/projects/b' }, tag: 'button' },
    })

    expect(bridge.workspaceSwitch).toHaveBeenCalledWith({ chatId: 'oc_1', chatType: 'p2p' }, '/projects/b')
    expect(channel.send).toHaveBeenCalledWith('oc_1', expect.objectContaining({ markdown: expect.stringContaining('已切换到 workspace **B**') }))
  })

  it('ignores card actions that are not workspace switches', async () => {
    const channel = fakeChannel()
    const bridge = fakeBridge()
    await startChannel({
      appId: 'id', appSecret: 'secret', domain: 'feishu', requireMention: true, dmMode: 'open',
      groupAllowlist: [], dmAllowlist: [], workspace: '/work', errorMessage: 'safe error',
      enableCardPicker: true,
    }, bridge, () => channel as any, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    await channel.handlers.get('cardAction')!({
      messageId: 'om_9', chatId: 'oc_1',
      operator: { openId: 'ou_1' },
      action: { value: { action: 'some-other', path: '/projects/b' }, tag: 'button' },
    })

    expect(bridge.workspaceSwitch).not.toHaveBeenCalled()
  })
})

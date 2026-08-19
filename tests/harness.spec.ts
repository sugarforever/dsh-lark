import { describe, expect, it, vi } from 'vitest'
import { HarnessConversationService } from '../src/harness.ts'

function fixture() {
  let seq = 0
  const agents = new Map<string, any>()
  const createHandle = async (sessionId: string) => {
    const events: any[] = []
    const agent = {
      session: { id: sessionId, get seq() { return seq }, events },
      whenIdle: vi.fn(async () => undefined),
      followup: vi.fn((message: any) => {
        events.push({ seq: seq++, type: 'turn/start', data: {} })
        events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `answer:${message.content[0].text}` }] } } })
        events.push({ seq: seq++, type: 'turn/end', data: { reason: { kind: 'completed' } } })
      }),
    }
    agents.set(String(sessionId), agent)
    return { agent, dispose: vi.fn(async () => undefined) }
  }
  const create = vi.fn(async ({ sessionId }: { sessionId: string }) => createHandle(sessionId))
  const resume = vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => createHandle(resumeSessionId))
  const flush = vi.fn(async () => true)
  const workspace = { path: '/first-workspace', title: 'first-workspace', attachSession: vi.fn(async () => undefined) }
  const mount = vi.fn(async () => undefined)
  const resolve = vi.fn(async (id?: string) => ({ id: id ?? 'default-preset' }))
  return { create, resume, flush, agents, workspace, mount, resolve }
}

function dependencies(f: ReturnType<typeof fixture>) {
  return {
    agents: { create: f.create, resume: f.resume, get: (id: string) => f.agents.get(id) },
    sessions: { flush: f.flush },
    sessionPersistence: { list: vi.fn(async () => []) },
    selection: () => ({ provider: 'p', model: 'm' }),
    agentPresets: { resolve: f.resolve, mount: f.mount },
    workspaceRegistry: {
      list: () => [f.workspace],
      resolveByPath: vi.fn(async () => undefined),
      create: vi.fn(async (path: string) => ({ path, title: path.split('/').pop() ?? path, attachSession: vi.fn(async () => undefined) })),
    },
  } as any
}

describe('HarnessConversationService', () => {
  it('lazily creates and reuses one agent for the same conversation', async () => {
    const f = fixture()
    const service = new HarnessConversationService(dependencies(f), { domain: 'feishu', workspace: '/work' })
    await expect(service.reply({ chatId: 'oc_1', chatType: 'p2p', content: 'one' })).resolves.toBe('answer:one')
    await expect(service.reply({ chatId: 'oc_1', chatType: 'p2p', content: 'two' })).resolves.toBe('answer:two')
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.flush).toHaveBeenCalledTimes(2)
  })

  it('resumes a persisted conversation instead of creating its session again', async () => {
    const f = fixture()
    const deps = dependencies(f)
    const sessionId = 'lark-v2-427e3361f60f3bd896c74f6acd7d065d2e0198db'
    deps.sessionPersistence.list = vi.fn(async () => [{ id: sessionId }])
    const service = new HarnessConversationService(deps, { domain: 'lark' })

    await expect(service.reply({ chatId: 'a', chatType: 'p2p', content: 'again' })).resolves.toBe('answer:again')

    expect(f.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: sessionId }))
    expect(f.create).not.toHaveBeenCalled()
  })

  it('reuses a live agent without trying to resume the same session', async () => {
    const f = fixture()
    const sessionId = 'lark-v2-427e3361f60f3bd896c74f6acd7d065d2e0198db'
    const liveHandle = await f.create({ sessionId })
    f.create.mockClear()
    const deps = dependencies(f)
    deps.sessionPersistence.list = vi.fn(async () => [{ id: sessionId }])
    const service = new HarnessConversationService(deps, { domain: 'lark' })

    await expect(service.reply({ chatId: 'a', chatType: 'p2p', content: 'live' })).resolves.toBe('answer:live')
    await service.dispose()

    expect(f.resume).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(liveHandle.dispose).not.toHaveBeenCalled()
  })

  it('isolates different chats and honors an explicit model route', async () => {
    const f = fixture()
    const deps = dependencies(f)
    deps.selection = () => ({ provider: 'default', model: 'default' })
    const service = new HarnessConversationService(deps, { domain: 'lark', workspace: '/work', provider: 'custom', model: 'model' })
    await service.reply({ chatId: 'a', chatType: 'p2p', content: 'one' })
    await service.reply({ chatId: 'b', chatType: 'p2p', content: 'two' })
    expect(f.create).toHaveBeenCalledTimes(2)
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ agentOptions: { provider: 'custom', model: 'model' }, meta: { cwd: '/work', agentPreset: 'default-preset' } }))
  })

  it('uses the first registered workspace and mounts the default agent preset', async () => {
    const f = fixture()
    const service = new HarnessConversationService(dependencies(f), { domain: 'feishu' })
    await service.reply({ chatId: 'a', chatType: 'p2p', content: 'one' })
    const options = f.create.mock.calls[0]![0] as any
    expect(options.meta).toEqual({ cwd: '/first-workspace', agentPreset: 'default-preset' })
    const agentCtx = { on: vi.fn(() => () => undefined) } as any
    await options.setup(agentCtx)
    expect(f.resolve).toHaveBeenCalledWith(undefined)
    expect(f.mount).toHaveBeenCalledWith(agentCtx, 'default-preset')
    expect(f.workspace.attachSession).toHaveBeenCalledWith(options.sessionId)
  })

  it('uses and mounts an explicitly configured workspace and preset', async () => {
    const f = fixture()
    const explicit = { path: '/configured', attachSession: vi.fn(async () => undefined) }
    const deps = dependencies(f)
    deps.workspaceRegistry.resolveByPath = vi.fn(async () => explicit)
    const service = new HarnessConversationService(deps, { domain: 'feishu', workspace: '/configured', agentPreset: 'coding' })
    await service.reply({ chatId: 'a', chatType: 'p2p', content: 'one' })
    const options = f.create.mock.calls[0]![0] as any
    await options.setup({ on: vi.fn(() => () => undefined) } as any)
    expect(f.resolve).toHaveBeenCalledWith('coding')
    expect(explicit.attachSession).toHaveBeenCalledWith(options.sessionId)
  })

  it('disposes a newly created agent when workspace attachment fails', async () => {
    const f = fixture()
    f.workspace.attachSession.mockRejectedValueOnce(new Error('attach failed'))
    const service = new HarnessConversationService(dependencies(f), { domain: 'feishu' })
    await expect(service.reply({ chatId: 'a', chatType: 'p2p', content: 'one' })).rejects.toThrow('attach failed')
    const handle = await f.create.mock.results[0]!.value
    expect(handle.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a turn that commits no successful assistant answer', async () => {
    const create = vi.fn(async ({ sessionId }: any) => ({ agent: { session: { id: sessionId, seq: 0, events: [{ seq: 0, type: 'turn/end', data: { reason: { kind: 'error' } } }] }, whenIdle: async () => undefined, followup() {} }, dispose: async () => undefined }))
    const service = new HarnessConversationService({ agents: { create, resume: vi.fn(), get: () => undefined }, sessions: { flush: async () => true }, sessionPersistence: { list: async () => [] }, selection: () => ({ provider: 'p', model: 'm' }), agentPresets: { resolve: async () => ({ id: 'default' }), mount: async () => undefined }, workspaceRegistry: { list: () => [], resolveByPath: async () => undefined, create: async () => { throw new Error('no create') } } }, { domain: 'feishu', workspace: '/work' })
    await expect(service.reply({ chatId: 'a', chatType: 'p2p', content: 'one' })).rejects.toThrow(/successful assistant response/)
  })

  it('lists registered workspaces in registry order', async () => {
    const f = fixture()
    const service = new HarnessConversationService(dependencies(f), { domain: 'feishu' })
    await expect(service.workspaceList()).resolves.toEqual([{ path: '/first-workspace', title: 'first-workspace' }])
  })

  it('reports the default workspace before any explicit selection', async () => {
    const f = fixture()
    const service = new HarnessConversationService(dependencies(f), { domain: 'feishu' })
    await expect(service.workspaceCurrent({ chatId: 'oc_1', chatType: 'p2p' }))
      .resolves.toEqual({ path: '/first-workspace', title: 'first-workspace' })
  })

  it('switches a chat to a workspace and routes its next turn to a scoped session', async () => {
    const f = fixture()
    const service = new HarnessConversationService(dependencies(f), { domain: 'feishu' })
    await service.reply({ chatId: 'oc_1', chatType: 'p2p', content: 'before' })
    const beforeSessionId = f.create.mock.calls[0]![0].sessionId

    await expect(service.workspaceSwitch({ chatId: 'oc_1', chatType: 'p2p' }, '/first-workspace'))
      .resolves.toEqual({ path: '/first-workspace', title: 'first-workspace' })

    await service.reply({ chatId: 'oc_1', chatType: 'p2p', content: 'after' })
    expect(f.create).toHaveBeenCalledTimes(2)
    const afterCall = f.create.mock.calls[1]![0] as any
    expect(afterCall.sessionId).not.toBe(beforeSessionId)
    expect(afterCall.meta.cwd).toBe('/first-workspace')
  })

  it('adopts an unregistered directory path on switch (like the web UI add)', async () => {
    const f = fixture()
    const deps = dependencies(f)
    const service = new HarnessConversationService(deps, { domain: 'feishu' })
    await service.workspaceSwitch({ chatId: 'oc_1', chatType: 'p2p' }, '/brand/new')
    expect(deps.workspaceRegistry.create).toHaveBeenCalledWith('/brand/new')
  })

  it('registers a new workspace via the registry on add', async () => {
    const f = fixture()
    const deps = dependencies(f)
    const service = new HarnessConversationService(deps, { domain: 'feishu' })
    await expect(service.workspaceAdd('/new/dir')).resolves.toEqual({ path: '/new/dir', title: 'dir' })
    expect(deps.workspaceRegistry.create).toHaveBeenCalledWith('/new/dir')
  })
})

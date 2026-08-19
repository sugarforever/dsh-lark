import { basename } from 'node:path'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { conversationKey, summarizeTurn, toSessionId } from './conversation.ts'
import type { ConversationMessage } from './conversation.ts'
import type { DomainName } from './config.ts'
import { createMemoryChatWorkspaceStore } from './chat-workspace.ts'
import type { ChatWorkspaceStore } from './chat-workspace.ts'
import type { WorkspaceSummary } from './workspace-command.ts'

interface AgentLike {
  session: { id: unknown; seq: number; events: readonly any[] }
  whenIdle(): Promise<void>
  followup(message: ReturnType<typeof createUserMessage>): void
}

interface AgentHandleLike { agent: AgentLike; dispose(): Promise<void> }

interface WorkspaceLike {
  path: string
  title: string
  attachSession(sessionId: unknown): Promise<void>
}

export interface HarnessDependencies {
  agents: {
    create: (options: any) => Promise<AgentHandleLike>
    resume: (options: any) => Promise<AgentHandleLike>
    get: (id: ReturnType<typeof toSessionId>) => AgentLike | undefined
  }
  sessions: { flush(session: AgentLike['session']): Promise<unknown> }
  sessionPersistence: { list(): Promise<Array<{ id: string }>> }
  selection(): { provider: string; model: string }
  agentPresets: {
    resolve(id?: string): Promise<{ id: string }>
    mount(agentCtx: Parameters<typeof installModelSelection>[0], id?: string): Promise<unknown>
  }
  workspaceRegistry: {
    list(): WorkspaceLike[]
    resolveByPath(path: string): Promise<WorkspaceLike | undefined>
    create(path: string, title?: string): Promise<WorkspaceLike>
  }
  chatWorkspaces?: ChatWorkspaceStore
}

export interface HarnessBridgeConfig {
  domain: DomainName
  workspace?: string
  agentPreset?: string
  provider?: string
  model?: string
}

export interface InboundMessage extends ConversationMessage { content: string }

export class HarnessConversationService {
  private readonly handles = new Map<string, Promise<AgentHandleLike>>()
  private readonly chatWorkspaces: ChatWorkspaceStore

  constructor(private readonly deps: HarnessDependencies, private readonly config: HarnessBridgeConfig) {
    this.chatWorkspaces = deps.chatWorkspaces ?? createMemoryChatWorkspaceStore()
  }

  async reply(message: InboundMessage): Promise<string> {
    const chatKey = conversationKey(message)
    const selectedPath = await this.chatWorkspaces.get(chatKey)
    // Only an explicit `/workspace` selection diverges the session key: an
    // unselected chat keeps the plain key so existing sessions stay intact
    // across upgrades, while a switched chat gets a fresh session in its dir.
    const key = selectedPath !== undefined
      ? conversationKey(message, selectedPath)
      : conversationKey(message)
    const cwdPath = selectedPath ?? await this.resolveWorkspacePath()
    const handle = await this.getOrCreate(key, cwdPath)
    const agent = handle.agent
    await agent.whenIdle()
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.content }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await this.deps.sessions.flush(agent.session)
    const result = summarizeTurn(agent.session.events, firstSeq)
    if (!result.ok) throw new Error('Harness turn did not produce a successful assistant response')
    return result.text
  }

  /** All registered workspaces, in registry display order. */
  async workspaceList(): Promise<WorkspaceSummary[]> {
    return this.deps.workspaceRegistry.list().map(w => ({ path: w.path, title: w.title }))
  }

  /** The workspace the conversation is currently bound to (selected or default). */
  async workspaceCurrent(conversation: ConversationMessage): Promise<WorkspaceSummary | undefined> {
    const chatKey = conversationKey(conversation)
    const selectedPath = await this.chatWorkspaces.get(chatKey)
    const path = selectedPath ?? await this.resolveWorkspacePath()
    const entity = await this.findWorkspace(path)
    return entity ? { path: entity.path, title: entity.title } : { path, title: basename(path) }
  }

  /** Register a directory as a workspace (like the web UI's "add workspace"). */
  async workspaceAdd(path: string): Promise<WorkspaceSummary> {
    const ws = await this.deps.workspaceRegistry.create(path)
    return { path: ws.path, title: ws.title }
  }

  /**
   * Switch a conversation to a workspace, selected by title or path. A bare
   * path that is not yet registered is adopted (created) like the web UI.
   * Persists the selection so it survives restarts.
   */
  async workspaceSwitch(conversation: ConversationMessage, selector: string): Promise<WorkspaceSummary> {
    const list = this.deps.workspaceRegistry.list()
    let ws = list.find(w => w.title === selector) ?? list.find(w => w.path === selector)
    if (ws === undefined) {
      try {
        ws = await this.deps.workspaceRegistry.create(selector)
      } catch {
        // not a resolvable directory — fall through to the error below
      }
    }
    if (ws === undefined) {
      throw new Error(`找不到 workspace「${selector}」。用 /workspace 查看已登记的目录，或 /workspace add <路径> 添加。`)
    }
    const chatKey = conversationKey(conversation)
    await this.chatWorkspaces.set(chatKey, ws.path)
    return { path: ws.path, title: ws.title }
  }

  async dispose(): Promise<void> {
    const handles = await Promise.allSettled(this.handles.values())
    await Promise.all(handles.flatMap(result => result.status === 'fulfilled' ? [result.value.dispose()] : []))
    this.handles.clear()
  }

  private async resolveWorkspacePath(): Promise<string> {
    if (this.config.workspace !== undefined) {
      const ws = await this.deps.workspaceRegistry.resolveByPath(this.config.workspace)
      return ws?.path ?? this.config.workspace
    }
    return this.deps.workspaceRegistry.list()[0]?.path ?? process.cwd()
  }

  private async findWorkspace(path: string): Promise<WorkspaceLike | undefined> {
    const known = this.deps.workspaceRegistry.list().find(w => w.path === path)
    if (known !== undefined) return known
    return this.deps.workspaceRegistry.resolveByPath(path).catch(() => undefined)
  }

  private getOrCreate(key: string, cwdPath: string): Promise<AgentHandleLike> {
    let pending = this.handles.get(key)
    if (pending !== undefined) return pending
    pending = this.createAgent(key, cwdPath).catch((error: unknown) => {
      this.handles.delete(key)
      throw error
    })
    this.handles.set(key, pending)
    return pending
  }

  private async createAgent(key: string, cwdPath: string): Promise<AgentHandleLike> {
    const sessionId = toSessionId(this.config.domain, key)
    const liveAgent = this.deps.agents.get(sessionId)
    if (liveAgent !== undefined) {
      return { agent: liveAgent, dispose: async () => undefined }
    }
    const fallback = this.deps.selection()
    const selection = {
      provider: this.config.provider ?? fallback.provider,
      model: this.config.model ?? fallback.model,
    }
    const workspace = await this.findWorkspace(cwdPath)
    const cwd = workspace?.path ?? cwdPath
    const agentPreset = (await this.deps.agentPresets.resolve(this.config.agentPreset)).id
    const setup = async (agentCtx: Parameters<typeof installModelSelection>[0]) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined })
      await this.deps.agentPresets.mount(agentCtx, agentPreset)
    }
    const persisted = (await this.deps.sessionPersistence.list()).some(item => item.id === sessionId)
    const handle = persisted
      ? await this.deps.agents.resume({ resumeSessionId: sessionId, agentOptions: selection, setup })
      : await this.deps.agents.create({
        sessionId,
        meta: { cwd, agentPreset },
        agentOptions: selection,
        setup,
      })
    try {
      await workspace?.attachSession(sessionId)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
    return handle
  }
}

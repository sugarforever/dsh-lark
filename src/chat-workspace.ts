import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

/**
 * Durable mapping from a conversation key (see `conversationKey`) to the
 * workspace path a chat has currently selected via the `/workspace` command.
 * Persisting the selection means a chat keeps working in its chosen directory
 * across restarts instead of silently reverting to the default.
 */
export interface ChatWorkspaceStore {
  /** Resolve the selected workspace path for a conversation key, if any. */
  get(chatKey: string): Promise<string | undefined>
  /** Remember the selected workspace path for a conversation key. */
  set(chatKey: string, workspacePath: string): Promise<void>
  /** Forget a conversation's selection (not used yet, kept for symmetry). */
  clear(chatKey: string): Promise<void>
}

/** In-memory store — used by tests and as a no-persistence fallback. */
export function createMemoryChatWorkspaceStore(): ChatWorkspaceStore {
  const state = new Map<string, string>()
  return {
    get: async key => state.get(key),
    set: async (key, path) => { state.set(key, path) },
    clear: async key => { state.delete(key) },
  }
}

const chatWorkspaceSpec = defineDomain({
  name: 'lark_chat_workspace',
  version: 1,
  tables: {
    selections: domainTable(z.object({ path: z.string() })),
  },
})

/**
 * Durable store backed by the Harness storage domain. The domain name is
 * namespaced to this plugin so it never collides with other domains.
 */
export async function createDurableChatWorkspaceStore(ctx: Context): Promise<{ store: ChatWorkspaceStore; dispose(): Promise<void> }> {
  const storageDomain = ctx.get('storageDomain') as { open(spec: unknown): Promise<{ table(name: string): { get(key: string): Promise<{ path: string } | undefined>; put(key: string, value: { path: string }): Promise<void>; delete(key: string): Promise<void> }; close(): Promise<void> }> } | undefined
  if (storageDomain === undefined) {
    return { store: createMemoryChatWorkspaceStore(), dispose: async () => undefined }
  }
  const domain = await storageDomain.open(chatWorkspaceSpec)
  const table = domain.table('selections')
  return {
    store: {
      get: async key => (await table.get(key))?.path,
      set: async (key, path) => { await table.put(key, { path }) },
      clear: async key => { await table.delete(key) },
    },
    dispose: () => domain.close(),
  }
}

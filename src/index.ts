import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import { createLarkChannel } from '@larksuiteoapi/node-sdk'
import { ConfigSchema, LARK_SETTINGS_NAMESPACE, resolveSettingsConfig } from './config.ts'
import type { Config as PluginConfig, SettingsConfig } from './config.ts'
import { HarnessConversationService } from './harness.ts'
import { startChannel } from './channel.ts'
import { LarkRuntime } from './runtime.ts'
import { createDurableChatWorkspaceStore } from './chat-workspace.ts'
import { createSettingsApi } from './settings-api.ts'
import { handleSettingsRequest, SETTINGS_PATH } from './web.ts'

export const name = 'lark-channel'
export const inject = [
  'agents', 'sessions', 'sessionPersistence', 'agentDefaultModel', 'agentPresets', 'workspaceRegistry',
  'settings', 'credentials', 'webServer', 'storageDomain',
]
export const Config = ConfigSchema
export type { PluginConfig }
export { ConfigSchema } from './config.ts'

export async function apply(ctx: Context, rawConfig: PluginConfig): Promise<void> {
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const sessionPersistence = ctx.get('sessionPersistence')
  const defaultModel = ctx.get('agentDefaultModel')
  const agentPresets = ctx.get('agentPresets')
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const webServer = ctx.get('webServer')
  if (agents === undefined || sessions === undefined || sessionPersistence === undefined || defaultModel === undefined || agentPresets === undefined || workspaceRegistry === undefined || settings === undefined || credentials === undefined || webServer === undefined) {
    throw new Error('dsh-lark requires Harness agent, settings, credentials, workspace, and webServer services')
  }

  // Durable per-chat workspace selection so a chat keeps working in its chosen
  // directory across restarts (falls back to in-memory when storage is absent).
  const chatWorkspace = await createDurableChatWorkspaceStore(ctx)
  ctx.effect(() => () => void chatWorkspace.dispose(), 'dsh-lark: chat workspace store')

  const settingsScope = settings.register(
    settingsNamespace(LARK_SETTINGS_NAMESPACE),
    ConfigSchema,
    { base: rawConfig, applies: 'live' },
  )
  const namespace = settingsNamespace(LARK_SETTINGS_NAMESPACE)
  const currentSettings = (): SettingsConfig => resolveSettingsConfig(settingsScope.get())
  let apiUpdateDepth = 0

  const runtime = new LarkRuntime({
    settings: currentSettings,
    resolveSecret: async ref => (await credentials.resolve(credentialRef(ref)))?.value,
    start: async config => {
      const bridge = new HarnessConversationService({
        agents,
        sessions,
        sessionPersistence,
        selection: () => defaultModel.currentSelection(),
        agentPresets,
        workspaceRegistry,
        chatWorkspaces: chatWorkspace.store,
      }, config)
      return startChannel(config, bridge, createLarkChannel, ctx.logger, console)
    },
  })

  const api = createSettingsApi({
    getSettings: currentSettings,
    revision: () => settings.describe({ redactSecrets: true }).find(item => item.ns === namespace)?.revision ?? 0,
    beginUpdate: () => { apiUpdateDepth += 1 },
    endUpdate: () => { apiUpdateDepth -= 1 },
    updateSettings: (patch, unset, expectedRevision) => settings.mutate(namespace, [
      ...Object.entries(patch).map(([key, value]) => ({ op: 'set' as const, path: [key], value })),
      ...unset.map(key => ({ op: 'unset' as const, path: [key] })),
    ], expectedRevision),
    credentials: {
      describe: ref => credentials.describe(credentialRef(ref)),
      set: (ref, value) => credentials.set(credentialRef(ref), value),
      unset: ref => credentials.unset(credentialRef(ref)),
    },
    runtimeStatus: () => runtime.status(),
    reconcile: () => runtime.reconcile(),
  })

  settingsScope.watch(() => apiUpdateDepth > 0 ? undefined : runtime.reconcile())
  ctx.on('credentials/updated', ref => {
    if (apiUpdateDepth === 0 && ref === currentSettings().appSecretRef) void runtime.reconcile()
  })
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: SETTINGS_PATH,
    handler: (req, res) => handleSettingsRequest(req, res, api),
  }), 'dsh-lark: settings page')
  ctx.effect(() => () => runtime.dispose(), 'dsh-lark: runtime')
  await runtime.reconcile()
}

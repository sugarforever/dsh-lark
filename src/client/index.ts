import { createElement as h } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { LarkSettingsSection, type CredentialInfo, type ModelCatalog, type RuntimeState } from './LarkSettingsSection.tsx'
import { CLIENT_CSS } from './styles.ts'

const NS = 'dsh-lark'
const NAMESPACE = 'lark-channel'
const SECRET_REF = 'DSH_LARK_APP_SECRET'

const dictionaries = {
  zh: {
    nav: '飞书与 Lark', title: '飞书与 Lark', subtitle: '配置消息渠道，保存后无需重启 Harness', runtimeStatus: '运行状态', loading: '正在读取配置......',
    application: '应用凭据', appId: 'App ID', domain: '平台', appSecret: 'App Secret', secretPlaceholder: '留空表示保留现有 Secret', credentialConfigured: 'Secret 已配置', credentialMissing: 'Secret 未配置', readOnly: '由配置或启动环境提供，只读',
    access: '访问策略', requireMention: '群聊中必须 @机器人', dmMode: '单聊策略', open: '开放', allowlist: '仅白名单', disabled: '关闭', groupAllowlist: '群聊白名单', dmAllowlist: '用户白名单', onePerLine: '每行一个 ID',
    agent: 'Agent 配置', provider: 'Provider', model: 'Model', workspace: 'Workspace', agentPreset: 'Agent Preset', errorMessage: '失败提示', modelCatalogLoading: '正在加载模型目录......', harnessDefault: '跟随 Harness 默认配置', selectProviderFirst: '请先选择 Provider', notInCatalog: '当前目录中不可见',
    save: '保存并重新连接', saving: '正在保存......', saved: '已保存', saveFailed: '保存失败', loadFailed: '配置读取失败', removeSecret: '删除已保存的 Secret', removing: '正在删除......', removed: 'Secret 已删除', removeFailed: '删除失败',
  },
  en: {
    nav: 'Lark', title: 'Feishu & Lark', subtitle: 'Configure the message channel without restarting Harness', runtimeStatus: 'Runtime status', loading: 'Loading settings...',
    application: 'Application credentials', appId: 'App ID', domain: 'Platform', appSecret: 'App Secret', secretPlaceholder: 'Leave blank to keep the stored secret', credentialConfigured: 'Secret configured', credentialMissing: 'Secret missing', readOnly: 'Provided by config or launch environment; read-only',
    access: 'Access policy', requireMention: 'Require @mention in group chats', dmMode: 'Direct messages', open: 'Open', allowlist: 'Allowlist only', disabled: 'Disabled', groupAllowlist: 'Group allowlist', dmAllowlist: 'User allowlist', onePerLine: 'One ID per line',
    agent: 'Agent configuration', provider: 'Provider', model: 'Model', workspace: 'Workspace', agentPreset: 'Agent Preset', errorMessage: 'Failure message', modelCatalogLoading: 'Loading model catalog...', harnessDefault: 'Use Harness default', selectProviderFirst: 'Select a provider first', notInCatalog: 'Not in current catalog',
    save: 'Save and reconnect', saving: 'Saving...', saved: 'Saved', saveFailed: 'Save failed', loadFailed: 'Unable to load settings', removeSecret: 'Remove stored secret', removing: 'Removing...', removed: 'Secret removed', removeFailed: 'Remove failed',
  },
}

/** The resolved lark-channel settings section as the client renders it. */
export interface LarkSettingsValue {
  appId: string
  domain: 'feishu' | 'lark'
  requireMention: boolean
  dmMode: 'open' | 'allowlist' | 'disabled'
  groupAllowlist: string[]
  dmAllowlist: string[]
  provider?: string
  model?: string
  workspace?: string
  agentPreset?: string
  errorMessage: string
  appSecretRef: string
}

export interface RuntimeStatusInfo {
  state: RuntimeState
  message?: string
}

/** Everything the settings page needs, assembled over official Harness channels. */
export interface SettingsChannel {
  /** Reactive settings section snapshot; undefined until the first acceptance. */
  getSettings(): SettingsScopeSnapshot<LarkSettingsValue> | undefined
  subscribeSettings(onChange: () => void): () => void
  describeCredential(): Promise<CredentialInfo>
  subscribeCredential(onChange: () => void): () => void
  status(): Promise<RuntimeStatusInfo>
  /** Atomic apply; resolves with the post-reconcile runtime status. */
  apply(input: Record<string, unknown>): Promise<RuntimeStatusInfo>
  /** Remove the stored App Secret through Harness Credentials. */
  removeSecret(): Promise<void>
}

interface RpcResult<T> {
  rpcId: string
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
}

interface CredentialView { configured: boolean; source?: string; writable: boolean }

interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: {
    register(namespace: string, dicts: typeof dictionaries): unknown
    bind(namespace: string): (key: string) => string
  }
  connection: {
    api: {
      llm: {
        models(payload: Record<string, never>): Promise<RpcResult<ModelCatalog>>
      }
      credentials: {
        describe(payload: { refs: string[] }): Promise<RpcResult<{ credentials: Record<string, CredentialView> }>>
        set(payload: { ref: string; value: string }): Promise<RpcResult<Record<string, never>>>
        unset(payload: { ref: string }): Promise<RpcResult<Record<string, never>>>
      }
    }
  }
  settingsScope: {
    bind(spec: { namespace: string }): SettingsScope<LarkSettingsValue>
  }
  remote: {
    $on(event: 'credentials/updated' | 'credentials/reference-updated', listener: (ref: string) => void): () => void
  }
  slots: {
    inject(slot: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component: () => unknown): unknown
  }
}

export const name = 'dsh-lark'
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', ...init }).then(async response => {
    const value = await response.json() as T & { error?: string }
    if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
    return value
  })
}

function buildChannel(ctx: ClientContext): SettingsChannel {
  const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
  const credentialRef = () => scope.getSnapshot()?.value?.appSecretRef ?? SECRET_REF
  const unwrap = <T,>(response: RpcResult<T>): T => {
    if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
    return response.result.value
  }
  return {
    getSettings: () => scope.getSnapshot(),
    subscribeSettings: onChange => scope.subscribe(onChange),
    describeCredential: async () => {
      const ref = credentialRef()
      const value = unwrap(await ctx.connection.api.credentials.describe({ refs: [ref] }))
      return value.credentials[ref] ?? { configured: false, writable: true }
    },
    subscribeCredential: onChange => {
      const listener = (ref: string) => {
        if (ref === credentialRef()) onChange()
      }
      const disposeLegacy = ctx.remote.$on('credentials/updated', listener)
      const disposeCurrent = ctx.remote.$on('credentials/reference-updated', listener)
      return () => {
        disposeLegacy()
        disposeCurrent()
      }
    },
    status: () => fetchJson<RuntimeStatusInfo>('/dsh-lark/status'),
    apply: async input => {
      const value = await fetchJson<{ status: RuntimeStatusInfo }>('/dsh-lark/apply', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      return value.status
    },
    removeSecret: async () => {
      await ctx.connection.api.credentials.unset({ ref: credentialRef() })
    },
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-lark: client dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = NS
    style.textContent = CLIENT_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-lark: client styles')
  const t = ctx.locale.bind(NS)
  const loadModels = async (): Promise<ModelCatalog> => {
    const response = await ctx.connection.api.llm.models({})
    if (!response.result.ok) throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
    return response.result.value
  }
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action',
    id: 'open-document',
    priority: -1,
  }, () => null))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'lark',
    order: 45,
    label: () => t('nav'),
    locale: NS,
  }, () => h(LarkSettingsSection, { t, loadModels, channel: buildChannel(ctx) })))
}

import { createElement as h } from 'react'
import { LarkSettingsSection, type ModelCatalog } from './LarkSettingsSection.tsx'
import { CLIENT_CSS } from './styles.ts'

const NS = 'dsh-lark'
const dictionaries = {
  zh: {
    nav: '飞书与 Lark', title: '飞书与 Lark', subtitle: '配置消息渠道，保存后无需重启 Harness', runtimeStatus: '运行状态', loading: '正在读取配置......',
    application: '应用凭据', appId: 'App ID', domain: '平台', appSecret: 'App Secret', secretPlaceholder: '留空表示保留现有 Secret', credentialConfigured: 'Secret 已配置', credentialMissing: 'Secret 未配置', readOnly: '由配置或启动环境提供，只读',
    access: '访问策略', requireMention: '群聊中必须 @机器人', dmMode: '单聊策略', open: '开放', allowlist: '仅白名单', disabled: '关闭', groupAllowlist: '群聊白名单', dmAllowlist: '用户白名单', onePerLine: '每行一个 ID',
    agent: 'Agent 配置', provider: 'Provider', model: 'Model', reasoningEffort: '推理强度', maxTokens: '最大输出 Token', typingReaction: '处理中表情', workspace: 'Workspace', agentPreset: 'Agent Preset', errorMessage: '失败提示', modelCatalogLoading: '正在加载模型目录......', harnessDefault: '跟随 Harness 默认配置', selectProviderFirst: '请先选择 Provider', notInCatalog: '当前目录中不可见',
    save: '保存并重新连接', saving: '正在保存......', saved: '已保存', saveFailed: '保存失败', loadFailed: '配置读取失败', removeSecret: '删除已保存的 Secret', removing: '正在删除......', removed: 'Secret 已删除', removeFailed: '删除失败',
  },
  en: {
    nav: 'Lark', title: 'Feishu & Lark', subtitle: 'Configure the message channel without restarting Harness', runtimeStatus: 'Runtime status', loading: 'Loading settings...',
    application: 'Application credentials', appId: 'App ID', domain: 'Platform', appSecret: 'App Secret', secretPlaceholder: 'Leave blank to keep the stored secret', credentialConfigured: 'Secret configured', credentialMissing: 'Secret missing', readOnly: 'Provided by config or launch environment; read-only',
    access: 'Access policy', requireMention: 'Require @mention in group chats', dmMode: 'Direct messages', open: 'Open', allowlist: 'Allowlist only', disabled: 'Disabled', groupAllowlist: 'Group allowlist', dmAllowlist: 'User allowlist', onePerLine: 'One ID per line',
    agent: 'Agent configuration', provider: 'Provider', model: 'Model', reasoningEffort: 'Reasoning effort', maxTokens: 'Maximum output tokens', typingReaction: 'Processing reaction', workspace: 'Workspace', agentPreset: 'Agent Preset', errorMessage: 'Failure message', modelCatalogLoading: 'Loading model catalog...', harnessDefault: 'Use Harness default', selectProviderFirst: 'Select a provider first', notInCatalog: 'Not in current catalog',
    save: 'Save and reconnect', saving: 'Saving...', saved: 'Saved', saveFailed: 'Save failed', loadFailed: 'Unable to load settings', removeSecret: 'Remove stored secret', removing: 'Removing...', removed: 'Secret removed', removeFailed: 'Remove failed',
  },
}

interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: {
    register(namespace: string, dicts: typeof dictionaries): unknown
    bind(namespace: string): (key: string) => string
  }
  connection: {
    api: {
      llm: {
        models(payload: Record<string, never>): Promise<{
          rpcId: string
          result: { ok: true; value: ModelCatalog } | { ok: false; error: { code: string; message: string } }
        }>
      }
    }
  }
  slots: {
    inject(slot: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component: () => unknown): unknown
  }
}

export const name = 'dsh-lark'
export const inject = ['slots', 'locale', 'connection']

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
  }, () => h(LarkSettingsSection, { t, loadModels })))
}

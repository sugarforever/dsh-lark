import z from '@deepseek-ai/schemastery'

export type DomainName = 'feishu' | 'lark'
export type DirectMessageMode = 'open' | 'allowlist' | 'disabled'

export const LARK_APP_SECRET_REF = 'DSH_LARK_APP_SECRET'
export const LARK_SETTINGS_NAMESPACE = 'lark-channel'
const DEFAULT_ERROR_MESSAGE = '抱歉，处理这条消息时遇到了问题，请稍后重试。'
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

export interface Config {
  appId?: string
  /** @deprecated Use appSecretRef with the Harness credentials service. */
  appSecret?: string
  appSecretRef?: string
  domain?: DomainName
  requireMention?: boolean
  dmMode?: DirectMessageMode
  groupAllowlist?: string[]
  dmAllowlist?: string[]
  provider?: string
  model?: string
  workspace?: string
  agentPreset?: string
  errorMessage?: string
  /**
   * Send an interactive workspace-picker card on `/workspace` so the user can
   * switch working directories by clicking a button (mirrors the web UI).
   * Requires the app to receive the `card.action.trigger` callback (e.g. via
   * long connection). Disabled by default.
   */
  enableCardPicker?: boolean
}

export interface SettingsConfig extends Required<Pick<Config,
  'appId' | 'appSecretRef' | 'domain' | 'requireMention' | 'dmMode' | 'groupAllowlist' |
  'dmAllowlist' | 'errorMessage'>> {
  appSecret?: string
  provider?: string
  model?: string
  workspace?: string
  agentPreset?: string
  enableCardPicker?: boolean
}

export interface RuntimeConfig extends Omit<SettingsConfig, 'appSecretRef'> {
  appSecret: string
  appSecretRef: string
}

export const ConfigSchema: z<Config> = z.object({
  appId: z.string().default('').description('Feishu/Lark application ID'),
  appSecret: z.string().role('secret').description('Legacy literal application secret'),
  appSecretRef: z.string().role('credential-ref').default(LARK_APP_SECRET_REF).description('Harness credential reference for the application secret'),
  domain: z.union(['feishu', 'lark']).default('feishu'),
  requireMention: z.boolean().default(true),
  dmMode: z.union(['open', 'allowlist', 'disabled']).default('open'),
  groupAllowlist: z.array(z.string()).default([]),
  dmAllowlist: z.array(z.string()).default([]),
  provider: z.string(),
  model: z.string(),
  workspace: z.string(),
  agentPreset: z.string(),
  errorMessage: z.string().default(DEFAULT_ERROR_MESSAGE),
  enableCardPicker: z.boolean().default(false).description('Send an interactive workspace-picker card on /workspace'),
})

export function resolveSettingsConfig(config: Config): SettingsConfig {
  const appSecretRef = config.appSecretRef ?? LARK_APP_SECRET_REF
  if (!CREDENTIAL_REF_PATTERN.test(appSecretRef)) throw new TypeError('appSecretRef must be a POSIX environment variable name')
  const errorMessage = config.errorMessage ?? DEFAULT_ERROR_MESSAGE
  if (errorMessage.length > 500) throw new TypeError('errorMessage must not exceed 500 characters')
  return {
    appId: config.appId ?? '',
    appSecretRef,
    domain: config.domain ?? 'feishu',
    requireMention: config.requireMention ?? true,
    dmMode: config.dmMode ?? 'open',
    groupAllowlist: config.groupAllowlist ?? [],
    dmAllowlist: config.dmAllowlist ?? [],
    errorMessage,
    ...(config.appSecret === undefined ? {} : { appSecret: config.appSecret }),
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.workspace === undefined ? {} : { workspace: config.workspace }),
    ...(config.agentPreset === undefined ? {} : { agentPreset: config.agentPreset }),
    ...(config.enableCardPicker === undefined ? {} : { enableCardPicker: config.enableCardPicker }),
  }
}

export function resolveRuntimeConfig(config: SettingsConfig, resolvedSecret?: string): RuntimeConfig {
  if (config.appId.trim() === '') throw new TypeError('appId is required')
  const appSecret = resolvedSecret?.trim() || config.appSecret?.trim() || ''
  if (appSecret === '') throw new TypeError('appSecret is required')
  return { ...config, appSecret }
}

/** @deprecated Use resolveSettingsConfig and resolveRuntimeConfig. */
export function resolveConfig(config: Config): RuntimeConfig {
  const settings = resolveSettingsConfig(config)
  return resolveRuntimeConfig(settings, settings.appSecret)
}

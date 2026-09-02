import { resolveSettingsConfig } from './config.ts'
import type { Config, SettingsConfig } from './config.ts'
import type { RuntimeStatus } from './runtime.ts'

export interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

export interface SettingsApiDependencies {
  getSettings(): SettingsConfig
  revision(): number
  beginUpdate(): void
  endUpdate(): void
  updateSettings(patch: object, unset: string[], expectedRevision: number): Promise<void>
  credentials: {
    describe(ref: string): Promise<CredentialInfo>
    set(ref: string, value: string): Promise<void>
    unset(ref: string): Promise<void>
  }
  runtimeStatus(): RuntimeStatus
  reconcile(): Promise<void>
}

type NullableOverride = 'provider' | 'model' | 'reasoningEffort' | 'maxTokens' | 'typingReaction' | 'workspace' | 'agentPreset'
export type SettingsUpdate = Omit<Config, 'appSecret' | 'appSecretRef' | NullableOverride> & {
  appSecret?: string
  expectedRevision: number
} & { [K in NullableOverride]?: Exclude<Config[K], undefined> | null }

const SETTINGS_KEYS = new Set([
  'appId', 'domain', 'requireMention', 'dmMode', 'groupAllowlist', 'dmAllowlist',
  'provider', 'model', 'reasoningEffort', 'maxTokens', 'typingReaction', 'workspace', 'agentPreset', 'errorMessage', 'appSecret', 'expectedRevision',
])

export function createSettingsApi(deps: SettingsApiDependencies) {
  return {
    async describe() {
      const current = deps.getSettings()
      const { appSecret: _legacySecret, ...settings } = current
      const storedCredential = await deps.credentials.describe(current.appSecretRef)
      const credential = !storedCredential.configured && current.appSecret?.trim()
        ? { configured: true, source: 'legacy-config', writable: false }
        : storedCredential
      return {
        revision: deps.revision(),
        settings,
        credential,
        runtime: deps.runtimeStatus(),
      }
    },

    async update(input: SettingsUpdate) {
      assertPlainObject(input)
      for (const key of Object.keys(input)) {
        if (!SETTINGS_KEYS.has(key)) throw new TypeError(`unknown settings field: ${key}`)
      }
      const current = deps.getSettings()
      const { appSecret, expectedRevision, ...candidate } = input
      if (appSecret !== undefined && appSecret.length === 0) throw new TypeError('an empty App Secret cannot be stored; remove it instead')
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision is required')
      const patch: Record<string, unknown> = {}
      const unset: string[] = []
      for (const [key, value] of Object.entries(candidate)) {
        if (value === null) unset.push(key)
        else patch[key] = value
      }
      const unresolved = { ...current, ...patch } as Record<string, unknown>
      for (const key of unset) delete unresolved[key]
      const next = resolveSettingsConfig(unresolved)
      deps.beginUpdate()
      let failed = false
      let failure: unknown
      try {
        if (Object.keys(patch).length > 0 || unset.length > 0) await deps.updateSettings(patch, unset, expectedRevision)
        if (appSecret !== undefined) await deps.credentials.set(next.appSecretRef, appSecret)
      } catch (error) {
        failed = true
        failure = error
      }
      try {
        await deps.reconcile()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      } finally {
        deps.endUpdate()
      }
      if (failed) throw failure
      return await this.describe()
    },

    async unsetSecret() {
      const ref = deps.getSettings().appSecretRef
      deps.beginUpdate()
      let failed = false
      let failure: unknown
      try {
        await deps.credentials.unset(ref)
      } catch (error) {
        failed = true
        failure = error
      }
      try {
        await deps.reconcile()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      } finally {
        deps.endUpdate()
      }
      if (failed) throw failure
      return await this.describe()
    },
  }
}

function assertPlainObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('settings update must be an object')
}

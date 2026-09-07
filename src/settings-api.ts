import { resolveSettingsConfig } from './config.ts'
import type { Config, SettingsConfig } from './config.ts'
import type { RuntimeStatus } from './runtime.ts'

export interface SettingsApiDependencies {
  getSettings(): SettingsConfig
  revision(): number
  beginUpdate(): void
  endUpdate(): void
  updateSettings(patch: object, unset: string[], expectedRevision: number): Promise<void>
  credentials: {
    set(ref: string, value: string): Promise<void>
  }
  runtimeStatus(): RuntimeStatus
  reconcile(): Promise<void>
}

type NullableOverride = 'provider' | 'model' | 'workspace' | 'agentPreset'
export type SettingsUpdate = Omit<Config, 'appSecret' | 'appSecretRef' | NullableOverride> & {
  appSecret?: string
  expectedRevision: number
} & { [K in NullableOverride]?: string | null }

export interface ApplyResult {
  /** Post-reconcile runtime status, so a save and the connection it causes settle in one round trip. */
  status: RuntimeStatus
  /** Namespace revision after the commit. */
  revision: number
}

const SETTINGS_KEYS = new Set([
  'appId', 'domain', 'requireMention', 'dmMode', 'groupAllowlist', 'dmAllowlist',
  'provider', 'model', 'workspace', 'agentPreset', 'errorMessage', 'appSecret', 'expectedRevision',
])

export function createSettingsApi(deps: SettingsApiDependencies) {
  return {
    /** Runtime status is a plugin-owned runtime fact, not a settings field; the page reads it here. */
    status(): RuntimeStatus {
      return deps.runtimeStatus()
    },

    /**
     * Atomic save: settings fields and an optional App Secret are committed
     * through their own services, then the runtime reconciles ONCE. The
     * Settings and Credentials update events raised inside the write are
     * suppressed (see `beginUpdate`/`endUpdate` in the caller) so the channel
     * never passes through a "new App ID + old Secret" intermediate state.
     */
    async apply(input: SettingsUpdate): Promise<ApplyResult> {
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
      return { status: deps.runtimeStatus(), revision: deps.revision() }
    },
  }
}

function assertPlainObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('settings update must be an object')
}

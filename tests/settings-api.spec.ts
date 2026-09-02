import { describe, expect, it, vi } from 'vitest'
import { createSettingsApi } from '../src/settings-api.ts'
import { resolveSettingsConfig } from '../src/config.ts'

function setup(overrides: Record<string, unknown> = {}) {
  let current = resolveSettingsConfig({ appId: 'id' })
  const update = vi.fn(async (patch: object, _unset: string[], _expectedRevision: number) => { current = resolveSettingsConfig({ ...current, ...patch }) })
  const credentials = {
    describe: vi.fn(async () => ({ configured: true, source: 'file', writable: true })),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
  const api = createSettingsApi({
    getSettings: () => current,
    revision: () => 7,
    beginUpdate: vi.fn(),
    endUpdate: vi.fn(),
    updateSettings: async (patch, unset, expectedRevision) => {
      update(patch, unset, expectedRevision)
      const next = { ...current, ...patch } as Record<string, unknown>
      for (const key of unset) delete next[key]
      current = resolveSettingsConfig(next)
    },
    credentials,
    runtimeStatus: () => ({ state: 'connected' as const }),
    reconcile: vi.fn(async () => undefined),
    ...overrides,
  })
  return { api, update, credentials }
}

describe('settings API', () => {
  it('describes settings and credential status without exposing a value', async () => {
    const { api } = setup()
    const result = await api.describe()
    expect(result.settings).toMatchObject({ appId: 'id' })
    expect(result.credential).toEqual({ configured: true, source: 'file', writable: true })
    expect(JSON.stringify(result)).not.toContain('actual-secret')
    expect(result.settings).not.toHaveProperty('appSecret')
    expect(result.revision).toBe(7)
  })

  it('reports a legacy configured secret as configured but read-only', async () => {
    const legacy = resolveSettingsConfig({ appId: 'id', appSecret: 'legacy-secret' })
    const { api } = setup({
      getSettings: () => legacy,
      credentials: {
        describe: async () => ({ configured: false, writable: true }),
        set: vi.fn(),
        unset: vi.fn(),
      },
    })

    const result = await api.describe()
    expect(result.credential).toEqual({ configured: true, source: 'legacy-config', writable: false })
    expect(JSON.stringify(result)).not.toContain('legacy-secret')
  })

  it('writes settings and a supplied secret through separate services', async () => {
    const { api, update, credentials } = setup()
    await api.update({ appId: 'next', domain: 'lark', appSecret: 'actual-secret', expectedRevision: 7 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ appId: 'next', domain: 'lark' }), [], 7)
    expect(update.mock.calls[0]![0]).not.toHaveProperty('appSecret')
    expect(credentials.set).toHaveBeenCalledWith('DSH_LARK_APP_SECRET', 'actual-secret')
  })

  it('unsets blank optional overrides and forwards the expected revision', async () => {
    const { api, update } = setup()
    await api.update({ provider: null, model: null, expectedRevision: 7 })
    expect(update).toHaveBeenCalledWith({}, ['provider', 'model'], 7)
  })

  it('updates and unsets model latency controls', async () => {
    const { api, update } = setup()
    await api.update({ reasoningEffort: 'low', maxTokens: 8192, typingReaction: 'Typing', expectedRevision: 7 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      reasoningEffort: 'low', maxTokens: 8192, typingReaction: 'Typing',
    }), [], 7)
    await api.update({ reasoningEffort: null, maxTokens: null, typingReaction: null, expectedRevision: 7 })
    expect(update).toHaveBeenLastCalledWith({}, ['reasoningEffort', 'maxTokens', 'typingReaction'], 7)
  })

  it('does not write a secret when the settings revision is stale', async () => {
    const updateSettings = vi.fn(async () => { throw new Error('settings conflict') })
    const { api, credentials } = setup({ updateSettings })
    await expect(api.update({ appId: 'next', appSecret: 'actual-secret', expectedRevision: 6 })).rejects.toThrow('settings conflict')
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('coordinates a combined settings and credential write as one runtime update', async () => {
    const order: string[] = []
    const { api } = setup({
      beginUpdate: () => order.push('begin'),
      endUpdate: () => order.push('end'),
      updateSettings: async () => { order.push('settings') },
      credentials: {
        describe: async () => ({ configured: true, source: 'file', writable: true }),
        set: async () => { order.push('credential') },
        unset: vi.fn(),
      },
      reconcile: async () => { order.push('reconcile') },
    })
    await api.update({ appId: 'next', appSecret: 'new-secret', expectedRevision: 7 })
    expect(order).toEqual(['begin', 'settings', 'credential', 'reconcile', 'end'])
  })

  it('reconciles a committed settings write when the credential write fails', async () => {
    const reconcile = vi.fn(async () => undefined)
    const { api } = setup({
      credentials: {
        describe: async () => ({ configured: true, source: 'file', writable: true }),
        set: async () => { throw new Error('credential write failed') },
        unset: vi.fn(),
      },
      reconcile,
    })

    await expect(api.update({ appId: 'next', appSecret: 'new-secret', expectedRevision: 7 })).rejects.toThrow('credential write failed')
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('removes the stored secret through credentials', async () => {
    const { api, credentials } = setup()
    await api.unsetSecret()
    expect(credentials.unset).toHaveBeenCalledWith('DSH_LARK_APP_SECRET')
  })

  it('rejects unknown fields and blank secret writes', async () => {
    const { api } = setup()
    await expect(api.update({ unknown: true } as any)).rejects.toThrow(/unknown/)
    await expect(api.update({ appSecret: '', expectedRevision: 7 })).rejects.toThrow(/empty/i)
  })
})

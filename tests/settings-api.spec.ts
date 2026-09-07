import { describe, expect, it, vi } from 'vitest'
import { createSettingsApi } from '../src/settings-api.ts'
import { resolveSettingsConfig } from '../src/config.ts'

function setup(overrides: Record<string, unknown> = {}) {
  let current = resolveSettingsConfig({ appId: 'id' })
  const update = vi.fn(async (patch: object, _unset: string[], _expectedRevision: number) => { current = resolveSettingsConfig({ ...current, ...patch }) })
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
    credentials: {
      set: vi.fn(async () => undefined),
    },
    runtimeStatus: () => ({ state: 'connected' as const }),
    reconcile: vi.fn(async () => undefined),
    ...overrides,
  })
  return { api, update }
}

describe('settings API', () => {
  it('reports the plugin runtime status without touching settings', async () => {
    const { api } = setup()
    expect(api.status()).toEqual({ state: 'connected' })
  })

  it('writes settings and a supplied secret through separate services and returns status', async () => {
    let current = resolveSettingsConfig({ appId: 'id' })
    const update = vi.fn(async (patch: object, _unset: string[], _expectedRevision: number) => { current = resolveSettingsConfig({ ...current, ...patch }) })
    const credentials = { set: vi.fn(async () => undefined) }
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
    })

    const result = await api.apply({ appId: 'next', domain: 'lark', appSecret: 'actual-secret', expectedRevision: 7 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ appId: 'next', domain: 'lark' }), [], 7)
    expect(update.mock.calls[0]![0]).not.toHaveProperty('appSecret')
    expect(credentials.set).toHaveBeenCalledWith('DSH_LARK_APP_SECRET', 'actual-secret')
    expect(result).toEqual({ status: { state: 'connected' }, revision: 7 })
  })

  it('unsets blank optional overrides and forwards the expected revision', async () => {
    const { api, update } = setup()
    await api.apply({ provider: null, model: null, expectedRevision: 7 })
    expect(update).toHaveBeenCalledWith({}, ['provider', 'model'], 7)
  })

  it('does not write a secret when the settings revision is stale', async () => {
    const updateSettings = vi.fn(async () => { throw new Error('settings conflict') })
    const credentials = { set: vi.fn(async () => undefined) }
    const api = createSettingsApi({
      getSettings: () => resolveSettingsConfig({ appId: 'id' }),
      revision: () => 7,
      beginUpdate: vi.fn(),
      endUpdate: vi.fn(),
      updateSettings,
      credentials,
      runtimeStatus: () => ({ state: 'connected' as const }),
      reconcile: vi.fn(async () => undefined),
    })
    await expect(api.apply({ appId: 'next', appSecret: 'actual-secret', expectedRevision: 6 })).rejects.toThrow('settings conflict')
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('coordinates a combined settings and credential write as one runtime update', async () => {
    const order: string[] = []
    const api = createSettingsApi({
      getSettings: () => resolveSettingsConfig({ appId: 'id' }),
      revision: () => 7,
      beginUpdate: () => order.push('begin'),
      endUpdate: () => order.push('end'),
      updateSettings: async () => { order.push('settings') },
      credentials: {
        set: async () => { order.push('credential') },
      },
      runtimeStatus: () => ({ state: 'connected' as const }),
      reconcile: async () => { order.push('reconcile') },
    })
    await api.apply({ appId: 'next', appSecret: 'new-secret', expectedRevision: 7 })
    expect(order).toEqual(['begin', 'settings', 'credential', 'reconcile', 'end'])
  })

  it('reconciles a committed settings write when the credential write fails', async () => {
    const reconcile = vi.fn(async () => undefined)
    const api = createSettingsApi({
      getSettings: () => resolveSettingsConfig({ appId: 'id' }),
      revision: () => 7,
      beginUpdate: vi.fn(),
      endUpdate: vi.fn(),
      updateSettings: vi.fn(async () => undefined),
      credentials: {
        set: async () => { throw new Error('credential write failed') },
      },
      runtimeStatus: () => ({ state: 'connected' as const }),
      reconcile,
    })

    await expect(api.apply({ appId: 'next', appSecret: 'new-secret', expectedRevision: 7 })).rejects.toThrow('credential write failed')
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('rejects unknown fields and blank secret writes', async () => {
    const { api } = setup()
    await expect(api.apply({ unknown: true } as any)).rejects.toThrow(/unknown/)
    await expect(api.apply({ appSecret: '', expectedRevision: 7 })).rejects.toThrow(/empty/i)
  })
})

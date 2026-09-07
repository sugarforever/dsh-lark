// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { apply, type SettingsChannel } from '../src/client/index.ts'
import { LarkSettingsSection } from '../src/client/LarkSettingsSection.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const BASE_SETTINGS = {
  appId: 'cli_existing', appSecretRef: 'DSH_LARK_APP_SECRET', domain: 'feishu', requireMention: true,
  dmMode: 'open', groupAllowlist: [] as string[], dmAllowlist: [] as string[], errorMessage: 'safe error',
}

function makeChannel(overrides: Partial<SettingsChannel> & Record<string, unknown> = {}) {
  const listeners = new Set<() => void>()
  const snapshot = {
    status: 'ready' as const,
    value: { ...BASE_SETTINGS },
    revision: 12,
    writable: true,
    mode: 'host' as const,
  }
  return {
    getSettings: vi.fn(() => snapshot),
    subscribeSettings: vi.fn((onChange: () => void) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    }),
    describeCredential: vi.fn(async () => ({ configured: true, source: 'file', writable: true })),
    subscribeCredential: vi.fn(() => () => undefined),
    status: vi.fn(async () => ({ state: 'connected' })),
    apply: vi.fn(async () => ({ state: 'connected' })),
    removeSecret: vi.fn(async () => undefined),
    emitSettings: () => { for (const cb of listeners) cb() },
    ...overrides,
  }
}

describe('Lark settings client plugin', () => {
  it('registers an embedded Harness settings section', () => {
    let meta: Record<string, unknown> | undefined
    let component: (() => unknown) | undefined
    const ctx = {
      effect: vi.fn((callback: () => unknown) => callback()),
      locale: {
        register: vi.fn(),
        bind: vi.fn(() => (key: string) => ({ nav: 'Lark', subtitle: 'Feishu/Lark channel' })[key] ?? key),
      },
      connection: { api: { llm: { models: vi.fn() }, credentials: { describe: vi.fn(), set: vi.fn(), unset: vi.fn() } } },
      settingsScope: { bind: vi.fn(() => ({ getSnapshot: () => undefined, subscribe: () => () => undefined })) },
      remote: { $on: vi.fn(() => () => undefined) },
      slots: {
        inject: vi.fn((_slot: string, callback: () => unknown) => callback()),
        register: vi.fn((nextMeta: Record<string, unknown>, nextComponent: () => unknown) => {
          meta = nextMeta
          component = nextComponent
        }),
      },
    }
    apply(ctx as any)
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.action', expect.any(Function))
    expect(ctx.slots.register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.action', id: 'open-document', priority: -1,
    }), expect.any(Function))
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(meta).toMatchObject({ name: 'settings.section', id: 'lark', order: 45 })
    expect(meta?.label).toBeTypeOf('function')
    expect(component).toBeTypeOf('function')
  })

  it('unwraps the Harness llm.models RPC response before rendering the settings section', async () => {
    let component: (() => unknown) | undefined
    const ctx = {
      effect: vi.fn((callback: () => unknown) => callback()),
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      connection: {
        api: {
          llm: {
            models: vi.fn(async () => ({
              rpcId: 'rpc-1',
              result: {
                ok: true,
                value: {
                  groups: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] }],
                  failures: [],
                },
              },
            })),
          },
          credentials: { describe: vi.fn(), set: vi.fn(), unset: vi.fn() },
        },
      },
      settingsScope: {
        bind: vi.fn(() => ({
          getSnapshot: () => ({
            status: 'ready' as const,
            value: {
              appId: 'cli_existing', appSecretRef: 'DSH_LARK_APP_SECRET', domain: 'feishu', requireMention: true,
              dmMode: 'open', groupAllowlist: [] as string[], dmAllowlist: [] as string[], errorMessage: 'safe error',
            },
            revision: 12,
            writable: true,
            mode: 'host' as const,
          }),
          subscribe: () => () => undefined,
        })),
      },
      remote: { $on: vi.fn(() => () => undefined) },
      slots: {
        inject: vi.fn((_slot: string, callback: () => unknown) => callback()),
        register: vi.fn((_meta: Record<string, unknown>, nextComponent: () => unknown) => { component = nextComponent }),
      },
    }

    apply(ctx as any)
    render(component!() as React.ReactElement)

    expect(await screen.findByRole('option', { name: 'OpenAI' })).toBeTruthy()
    expect(screen.getByLabelText('provider').tagName).toBe('SELECT')
  })

  it('uses the configured secret reference and observes both credential event names', async () => {
    let component: (() => unknown) | undefined
    const describe = vi.fn(async () => ({
      rpcId: 'credential-describe',
      result: { ok: true as const, value: { credentials: { CUSTOM_LARK_SECRET: { configured: true, writable: true } } } },
    }))
    const unset = vi.fn(async () => ({ rpcId: 'credential-unset', result: { ok: true as const, value: {} } }))
    const eventListeners = new Map<string, (ref: string) => void>()
    const ctx = {
      effect: vi.fn((callback: () => unknown) => callback()),
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      connection: {
        api: {
          llm: { models: vi.fn(async () => ({ rpcId: 'models', result: { ok: true, value: { groups: [], failures: [] } } })) },
          credentials: { describe, set: vi.fn(), unset },
        },
      },
      settingsScope: {
        bind: vi.fn(() => ({
          getSnapshot: () => ({
            status: 'ready' as const,
            value: { ...BASE_SETTINGS, appSecretRef: 'CUSTOM_LARK_SECRET' },
            revision: 12,
            writable: true,
            mode: 'host' as const,
          }),
          subscribe: () => () => undefined,
        })),
      },
      remote: {
        $on: vi.fn((event: string, listener: (ref: string) => void) => {
          eventListeners.set(event, listener)
          return () => eventListeners.delete(event)
        }),
      },
      slots: {
        inject: vi.fn((_slot: string, callback: () => unknown) => callback()),
        register: vi.fn((_meta: Record<string, unknown>, nextComponent: () => unknown) => { component = nextComponent }),
      },
    }

    apply(ctx as any)
    render(component!() as React.ReactElement)

    await waitFor(() => expect(describe).toHaveBeenCalledWith({ refs: ['CUSTOM_LARK_SECRET'] }))
    expect(eventListeners.has('credentials/updated')).toBe(true)
    expect(eventListeners.has('credentials/reference-updated')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'removeSecret' }))
    await waitFor(() => expect(unset).toHaveBeenCalledWith({ ref: 'CUSTOM_LARK_SECRET' }))
  })
})

describe('LarkSettingsSection', () => {
  it('loads value-free settings from the channel and renders labeled controls with textual status', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))
    expect(await screen.findByDisplayValue('cli_existing')).toBeTruthy()
    expect(screen.getByLabelText('appSecret').getAttribute('type')).toBe('password')
    expect(await screen.findByText('connected')).toBeTruthy()
    expect(await screen.findByText('credentialConfigured')).toBeTruthy()
  })

  it('submits changed settings through the atomic apply and announces success', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))
    const appId = await screen.findByLabelText('appId')
    fireEvent.change(appId, { target: { value: 'cli_next' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(channel.apply).toHaveBeenCalledTimes(1))
    const input = (channel.apply as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
    expect(input).toMatchObject({ appId: 'cli_next', expectedRevision: 12, provider: null })
    expect((await screen.findByRole('status')).textContent).toContain('saved')
  })

  it('preserves the loaded App ID and omits App Secret when only another setting changes', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))

    await screen.findByDisplayValue('cli_existing')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(channel.apply).toHaveBeenCalledTimes(1))
    const body = (channel.apply as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
    expect(body.appId).toBe('cli_existing')
    expect(body.requireMention).toBe(false)
    expect(body).not.toHaveProperty('appSecret')
  })

  it('renders the configured credential state as an explicit status badge', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))

    const status = await screen.findByLabelText('credentialConfigured')
    expect(status.getAttribute('data-state')).toBe('configured')
  })

  it('renders the missing credential state as an explicit status badge', async () => {
    const channel = makeChannel({ describeCredential: vi.fn(async () => ({ configured: false, writable: true })) })
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))

    const status = await screen.findByLabelText('credentialMissing')
    expect(status.getAttribute('data-state')).toBe('missing')
  })

  it('loads Harness model providers and keeps the model options linked to the selected provider', async () => {
    const channel = makeChannel({
      getSettings: vi.fn(() => ({
        status: 'ready' as const,
        value: { ...BASE_SETTINGS, provider: 'openai', model: 'gpt-5' },
        revision: 12,
        writable: true,
        mode: 'host' as const,
      })),
    })
    const loadModels = vi.fn(async () => ({
      groups: [
        {
          id: 'openai', name: 'OpenAI', models: [
            { id: 'gpt-5', name: 'GPT-5', description: 'General model', reasoning: true },
          ],
        },
        {
          id: 'anthropic', name: 'Anthropic', models: [
            { id: 'claude-sonnet', name: 'Claude Sonnet', description: 'Fast model', reasoning: false },
          ],
        },
      ],
      failures: [],
    }))

    render(h(LarkSettingsSection, { t: (key: string) => key, channel, loadModels }))

    const provider = await screen.findByLabelText('provider')
    const model = screen.getByLabelText('model')
    await waitFor(() => expect(provider.tagName).toBe('SELECT'))
    expect(loadModels).toHaveBeenCalledTimes(1)
    expect((provider as HTMLSelectElement).value).toBe('openai')
    expect((model as HTMLSelectElement).value).toBe('gpt-5')
    expect(screen.getByRole('option', { name: 'GPT-5' })).toBeTruthy()

    fireEvent.change(provider, { target: { value: 'anthropic' } })
    expect((model as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: 'Claude Sonnet' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'GPT-5' })).toBeNull()
  })

  it('preserves a saved provider and model that the current Harness catalog does not advertise', async () => {
    const channel = makeChannel({
      getSettings: vi.fn(() => ({
        status: 'ready' as const,
        value: { ...BASE_SETTINGS, provider: 'private-route', model: 'private-model' },
        revision: 12,
        writable: true,
        mode: 'host' as const,
      })),
    })
    const loadModels = vi.fn(async () => ({ groups: [], failures: [] }))

    render(h(LarkSettingsSection, { t: (key: string) => key, channel, loadModels }))

    expect((await screen.findByLabelText('provider') as HTMLSelectElement).value).toBe('private-route')
    expect((screen.getByLabelText('model') as HTMLSelectElement).value).toBe('private-model')
  })

  it('removes the stored App Secret through the channel and announces removal', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))
    await screen.findByLabelText('credentialConfigured')
    fireEvent.click(screen.getByRole('button', { name: 'removeSecret' }))
    await waitFor(() => expect(channel.removeSecret).toHaveBeenCalledTimes(1))
    expect((await screen.findByRole('status')).textContent).toContain('removed')
  })

  it('re-adopts the form when the settings scope reports a committed change', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))
    await screen.findByDisplayValue('cli_existing')
    channel.getSettings.mockReturnValue({
      status: 'ready' as const,
      value: { ...BASE_SETTINGS, appId: 'cli_external' },
      revision: 13,
      writable: true,
      mode: 'host' as const,
    })
    channel.emitSettings()
    expect(await screen.findByDisplayValue('cli_external')).toBeTruthy()
  })

  it('refreshes credential state when a committed setting changes the secret reference', async () => {
    const channel = makeChannel()
    render(h(LarkSettingsSection, { t: (key: string) => key, channel }))
    await screen.findByDisplayValue('cli_existing')
    const callsBeforeRefChange = channel.describeCredential.mock.calls.length

    channel.getSettings.mockReturnValue({
      status: 'ready' as const,
      value: { ...BASE_SETTINGS, appSecretRef: 'CUSTOM_LARK_SECRET' },
      revision: 13,
      writable: true,
      mode: 'host' as const,
    })
    channel.emitSettings()

    await waitFor(() => expect(channel.describeCredential).toHaveBeenCalledTimes(callsBeforeRefChange + 1))
  })
})

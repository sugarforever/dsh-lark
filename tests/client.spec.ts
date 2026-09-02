// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { apply } from '../src/client/index.ts'
import { LarkSettingsSection } from '../src/client/LarkSettingsSection.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
    const payload = {
      revision: 1,
      settings: {
        appId: 'cli_existing', domain: 'feishu', requireMention: true, dmMode: 'open',
        groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error',
      },
      credential: { configured: true, source: 'file', writable: true },
      runtime: { state: 'connected' },
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
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
        },
      },
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
})

describe('LarkSettingsSection', () => {
  const payload = {
    revision: 12,
    settings: {
      appId: 'cli_existing', appSecretRef: 'DSH_LARK_APP_SECRET', domain: 'feishu', requireMention: true,
      dmMode: 'open', groupAllowlist: [], dmAllowlist: [], errorMessage: 'safe error',
    },
    credential: { configured: true, source: 'file', writable: true },
    runtime: { state: 'connected' },
  }

  it('loads value-free settings and renders labeled controls with textual status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
    render(h(LarkSettingsSection, { t: (key: string) => key }))
    expect(await screen.findByDisplayValue('cli_existing')).toBeTruthy()
    expect(screen.getByLabelText('appSecret').getAttribute('type')).toBe('password')
    expect(screen.getByText('connected')).toBeTruthy()
    expect(screen.getByText('credentialConfigured')).toBeTruthy()
  })

  it('submits changed settings and announces success', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, settings: { ...payload.settings, appId: 'cli_next' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    render(h(LarkSettingsSection, { t: (key: string) => key }))
    const appId = await screen.findByLabelText('appId')
    fireEvent.change(appId, { target: { value: 'cli_next' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const init = fetch.mock.calls[1]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ appId: 'cli_next', expectedRevision: 12, provider: null })
    expect((await screen.findByRole('status')).textContent).toContain('saved')
  })

  it('loads and submits the processing and model latency controls', async () => {
    const configured = {
      ...payload,
      settings: { ...payload.settings, reasoningEffort: 'low', maxTokens: 8192, typingReaction: 'Typing' },
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(configured), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(configured), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    render(h(LarkSettingsSection, { t: (key: string) => key }))

    expect(await screen.findByDisplayValue('low')).toBeTruthy()
    expect(screen.getByDisplayValue('8192')).toBeTruthy()
    expect(screen.getByDisplayValue('Typing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String((fetch.mock.calls[1]![1] as RequestInit).body))).toMatchObject({
      reasoningEffort: 'low', maxTokens: 8192, typingReaction: 'Typing',
    })
  })

  it('preserves the loaded App ID and omits App Secret when only another setting changes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, settings: { ...payload.settings, requireMention: false } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    render(h(LarkSettingsSection, { t: (key: string) => key }))

    await screen.findByDisplayValue('cli_existing')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const body = JSON.parse(String((fetch.mock.calls[1]![1] as RequestInit).body)) as Record<string, unknown>
    expect(body.appId).toBe('cli_existing')
    expect(body.requireMention).toBe(false)
    expect(body).not.toHaveProperty('appSecret')
  })

  it('renders the configured credential state as an explicit status badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
    render(h(LarkSettingsSection, { t: (key: string) => key }))

    const status = await screen.findByLabelText('credentialConfigured')
    expect(status.getAttribute('data-state')).toBe('configured')
  })

  it('renders the missing credential state as an explicit status badge', async () => {
    const missing = { ...payload, credential: { configured: false, writable: true } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(missing), { status: 200 })))
    render(h(LarkSettingsSection, { t: (key: string) => key }))

    const status = await screen.findByLabelText('credentialMissing')
    expect(status.getAttribute('data-state')).toBe('missing')
  })

  it('loads Harness model providers and keeps the model options linked to the selected provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...payload,
      settings: { ...payload.settings, provider: 'openai', model: 'gpt-5' },
    }), { status: 200 })))
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

    render(h(LarkSettingsSection, { t: (key: string) => key, loadModels }))

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...payload,
      settings: { ...payload.settings, provider: 'private-route', model: 'private-model' },
    }), { status: 200 })))
    const loadModels = vi.fn(async () => ({ groups: [], failures: [] }))

    render(h(LarkSettingsSection, { t: (key: string) => key, loadModels }))

    expect((await screen.findByLabelText('provider') as HTMLSelectElement).value).toBe('private-route')
    expect((screen.getByLabelText('model') as HTMLSelectElement).value).toBe('private-model')
  })
})

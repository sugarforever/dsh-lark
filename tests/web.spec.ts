import { describe, expect, it, vi } from 'vitest'
import { handleApplyRequest, handleStatusRequest } from '../src/web.ts'

function response() {
  const headers = new Map<string, string>()
  let body = ''
  return {
    statusCode: 200,
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    end: vi.fn((value = '') => { body = value }),
    get body() { return body },
    headers,
  }
}

describe('status web route', () => {
  it('rejects non-loopback requests', async () => {
    const api = { status: vi.fn(() => ({ state: 'connected' })) }
    const res = response()
    await handleStatusRequest({ method: 'GET', headers: {}, socket: { remoteAddress: '192.168.1.2' } } as any, res as any, api as any)
    expect(res.statusCode).toBe(403)
    expect(api.status).not.toHaveBeenCalled()
  })

  it('serves the runtime status as JSON to loopback GETs', async () => {
    const api = { status: vi.fn(() => ({ state: 'connected' })) }
    const res = response()
    await handleStatusRequest({ method: 'GET', headers: { accept: 'application/json' }, socket: { remoteAddress: '::1' } } as any, res as any, api as any)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(api.status).toHaveBeenCalledOnce()
    expect(JSON.parse(res.body)).toEqual({ state: 'connected' })
  })

  it('answers method-not-allowed for non-GET requests', async () => {
    const api = { status: vi.fn() }
    const res = response()
    await handleStatusRequest({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any, res as any, api as any)
    expect(res.statusCode).toBe(405)
  })
})

describe('apply web route', () => {
  it('rejects non-loopback requests', async () => {
    const api = { status: vi.fn(), apply: vi.fn() }
    const res = response()
    await handleApplyRequest({ method: 'GET', headers: {}, socket: { remoteAddress: '192.168.1.2' } } as any, res as any, api as any)
    expect(res.statusCode).toBe(403)
  })

  it('serves status JSON for loopback GETs without applying', async () => {
    const api = { status: vi.fn(() => ({ state: 'connected' })), apply: vi.fn() }
    const res = response()
    await handleApplyRequest({ method: 'GET', headers: { accept: 'application/json' }, socket: { remoteAddress: '::1' } } as any, res as any, api as any)
    expect(res.body).not.toContain('secret-value')
    expect(api.status).toHaveBeenCalledOnce()
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('dispatches an atomic apply for same-origin loopback POSTs and returns its result', async () => {
    const api = { status: vi.fn(), apply: vi.fn(async () => ({ status: { state: 'connected' }, revision: 8 })) }
    const res = response()
    const request = Object.assign((async function* () { yield Buffer.from('{"appId":"next","expectedRevision":7}') })(), {
      method: 'POST', headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' }, socket: { remoteAddress: '::1' },
    })
    await handleApplyRequest(request as any, res as any, api as any)
    expect(api.apply).toHaveBeenCalledWith({ appId: 'next', expectedRevision: 7 })
    expect(JSON.parse(res.body)).toEqual({ status: { state: 'connected' }, revision: 8 })
  })

  it('rejects cross-origin mutations even when they arrive from loopback', async () => {
    const api = { status: vi.fn(), apply: vi.fn() }
    const res = response()
    const request = Object.assign((async function* () { yield Buffer.from('{}') })(), {
      method: 'POST', headers: { origin: 'https://attacker.example', host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' },
    })
    await handleApplyRequest(request as any, res as any, api as any)
    expect(res.statusCode).toBe(403)
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('rejects mutations addressed through a non-loopback Host', async () => {
    const api = { status: vi.fn(), apply: vi.fn() }
    const res = response()
    const request = Object.assign((async function* () { yield Buffer.from('{}') })(), {
      method: 'POST', headers: { origin: 'https://attacker.example', host: 'attacker.example' }, socket: { remoteAddress: '127.0.0.1' },
    })
    await handleApplyRequest(request as any, res as any, api as any)
    expect(res.statusCode).toBe(403)
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('surfaces apply failures as a 400 without a stack trace', async () => {
    const api = { status: vi.fn(), apply: vi.fn(async () => { throw new Error('unknown settings field: nope') }) }
    const res = response()
    const request = Object.assign((async function* () { yield Buffer.from('{"nope":true}') })(), {
      method: 'POST', headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' },
    })
    await handleApplyRequest(request as any, res as any, api as any)
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('unknown settings field')
    expect(res.body).not.toContain('at ')
  })
})

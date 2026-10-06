import { describe, expect, it, vi } from 'vitest'
import { createDotIngressEndpointClient } from './dot-remote-ingress-client'
import type { DotIngressTarget } from './dot-remote-ingress-pipe'

// FIXTURE_ONLY: a synthetic discovery result; the injected send never opens a pipe.
const TARGET: DotIngressTarget = {
  endpoint: '\\\\.\\pipe\\orca-4242-fixture-dot',
  ingressToken: 'f'.repeat(64),
  runtimeId: 'runtime-fixture'
}

describe('dot ingress endpoint client', () => {
  it('reads the discovery file and calls the dot endpoint with the dot token, no envelope', async () => {
    const send = vi.fn(async () => ({
      id: 'x',
      ok: true as const,
      result: { fixture: true },
      _meta: { runtimeId: 'r' }
    }))
    const readTarget = vi.fn(() => TARGET)
    const client = createDotIngressEndpointClient({
      userDataPath: 'C:/fixture/userData',
      ready: () => true,
      send,
      readTarget
    })
    const params = { contractVersion: 2, dotRequestId: '30000000-0000-4000-8000-000000000001' }
    expect(await client.call('dotIngress.requests.cancel', params, 180_000)).toEqual({
      ok: true,
      result: { fixture: true }
    })
    expect(readTarget).toHaveBeenCalledWith('C:/fixture/userData')
    expect(send).toHaveBeenCalledWith(TARGET, 'dotIngress.requests.cancel', params, 180_000)
  })

  it('returns the code of a refusal and nothing else', async () => {
    const send = vi.fn(async () => ({
      id: 'x',
      ok: false as const,
      error: { code: 'dot_workspace_unknown', message: 'text', data: { reason: 'x' } },
      _meta: { runtimeId: 'r' }
    }))
    const client = createDotIngressEndpointClient({
      userDataPath: 'C:/fixture/userData',
      ready: () => true,
      send,
      readTarget: () => TARGET
    })
    expect(await client.call('dotIngress.requests.submit', {}, 1_000)).toEqual({
      ok: false,
      kind: 'refused',
      code: 'dot_workspace_unknown'
    })
  })

  it('is unavailable without a discovery file or a connection', async () => {
    const missing = createDotIngressEndpointClient({
      userDataPath: 'C:/fixture/userData',
      ready: () => true,
      send: vi.fn(),
      readTarget: () => null
    })
    expect(await missing.call('dotIngress.requests.submit', {}, 1_000)).toEqual({
      ok: false,
      kind: 'unavailable'
    })
    const refused = createDotIngressEndpointClient({
      userDataPath: 'C:/fixture/userData',
      ready: () => true,
      send: vi.fn(async () => {
        throw new Error('Fixture: connect failed')
      }),
      readTarget: () => TARGET
    })
    expect(await refused.call('dotIngress.requests.submit', {}, 1_000)).toEqual({
      ok: false,
      kind: 'unavailable'
    })
  })

  it('reports readiness from the endpoint control, and not ready when it throws', () => {
    const base = { userDataPath: 'C:/fixture/userData', send: vi.fn(), readTarget: () => TARGET }
    expect(createDotIngressEndpointClient({ ...base, ready: () => true }).ready()).toBe(true)
    expect(
      createDotIngressEndpointClient({
        ...base,
        ready: () => {
          throw new Error('Fixture: no control')
        }
      }).ready()
    ).toBe(false)
  })
})

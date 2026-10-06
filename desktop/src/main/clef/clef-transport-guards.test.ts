import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import { setActiveSink } from '../observability/tracer'
import { CLEF_OVERALL_DEADLINE_MS } from './clef-transport-signals'
import { sendClefRequest } from './clef-transport'
import {
  FIXTURE_ONLY_ACCOUNT_ID,
  FIXTURE_ONLY_RUN_URL,
  FIXTURE_ONLY_TOKEN,
  allowEveryAttempt,
  fixtureBody,
  fixtureCredentials,
  fixtureDeps
} from './clef-transport.test-fixture'

const ensureProxy = vi.hoisted(() => vi.fn(async () => ({ source: 'none' })))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: ensureProxy }))

function request(overrides: Partial<Parameters<typeof sendClefRequest>[0]> = {}) {
  return {
    credentials: fixtureCredentials(),
    body: fixtureBody(),
    beforeAttempt: allowEveryAttempt,
    ...overrides
  }
}

function unavailable(detail: RouteBlockerDetail): RouteBlocker {
  return { reason: 'classifier_unavailable', detail }
}

afterEach(() => {
  setActiveSink(null)
  ensureProxy.mockClear()
})

describe('sendClefRequest deadline and cancellation', () => {
  it('ends a hung attempt at the 30 s overall deadline without retrying', async () => {
    const deps = fixtureDeps([{ hangUntilAbort: true }, { status: 200 }])
    const pending = sendClefRequest(request(), deps)
    await vi.waitFor(() => expect(deps.client.calls).toHaveLength(1))
    expect(deps.timers.pending().map((timer) => timer.ms)).toEqual([CLEF_OVERALL_DEADLINE_MS])
    deps.timers.pending()[0].fire()

    expect(await pending).toEqual({
      kind: 'blocked',
      blocker: unavailable('transient_exhausted'),
      latch: null,
      status: null,
      errorClass: 'deadline',
      attempts: 1
    })
    expect(deps.client.calls).toHaveLength(1)
  })

  it('stops at the deadline while waiting to retry', async () => {
    const deps = fixtureDeps([{ status: 503 }, { status: 200 }])
    deps.sleep = async () => deps.timers.pending()[0].fire()
    const outcome = await sendClefRequest(request(), deps)
    expect(outcome).toMatchObject({ errorClass: 'deadline', status: 503, attempts: 1 })
    expect(deps.client.calls).toHaveLength(1)
  })

  it('returns aborted with no call or proxy work when the caller already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = fixtureDeps([])
    const outcome = await sendClefRequest(request({ signal: controller.signal }), deps)
    expect(outcome).toEqual({ kind: 'aborted', attempts: 0 })
    expect(deps.client.calls).toEqual([])
    expect(deps.proxyPreparations).toBe(0)
  })

  it('passes the caller abort through to the in-flight fetch', async () => {
    const controller = new AbortController()
    const deps = fixtureDeps([{ hangUntilAbort: true }])
    const pending = sendClefRequest(request({ signal: controller.signal }), deps)
    await vi.waitFor(() => expect(deps.client.calls).toHaveLength(1))
    controller.abort()
    expect(await pending).toEqual({ kind: 'aborted', attempts: 1 })
    expect(deps.client.calls[0].init.signal?.aborted).toBe(true)
    expect(deps.timers.pending()).toEqual([])
  })

  it('returns aborted when the caller aborts between attempts', async () => {
    const controller = new AbortController()
    const deps = fixtureDeps([{ status: 503 }, { status: 200 }])
    deps.sleep = async () => controller.abort()
    const outcome = await sendClefRequest(request({ signal: controller.signal }), deps)
    expect(outcome).toEqual({ kind: 'aborted', attempts: 1 })
  })
})

describe('sendClefRequest beforeAttempt budget hook', () => {
  it('asks before every billed attempt', async () => {
    const asked: number[] = []
    const deps = fixtureDeps([{ status: 500 }, { status: 200 }])
    const beforeAttempt = (attempt: number) => {
      asked.push(attempt)
      return { proceed: true as const }
    }
    await sendClefRequest(request({ beforeAttempt }), deps)
    expect(asked).toEqual([1, 2])
  })

  it('makes no call when the first attempt is vetoed', async () => {
    const deps = fixtureDeps([])
    const veto = { proceed: false as const, blocker: unavailable('budget_exhausted') }
    const outcome = await sendClefRequest(request({ beforeAttempt: () => veto }), deps)
    expect(outcome).toEqual({
      kind: 'blocked',
      blocker: unavailable('budget_exhausted'),
      latch: null,
      status: null,
      errorClass: 'vetoed',
      attempts: 0
    })
    expect(deps.client.calls).toEqual([])
  })

  it('reports the last failure when a retry is vetoed without a blocker', async () => {
    const deps = fixtureDeps([{ status: 503 }, { status: 200 }])
    const beforeAttempt = (attempt: number) =>
      attempt === 1 ? { proceed: true as const } : { proceed: false as const }
    const outcome = await sendClefRequest(request({ beforeAttempt }), deps)
    expect(outcome).toEqual({
      kind: 'blocked',
      blocker: unavailable('transient_exhausted'),
      latch: null,
      status: 503,
      errorClass: 'vetoed',
      attempts: 1
    })
  })

  it('fails closed as budget_exhausted when the hook throws', async () => {
    const deps = fixtureDeps([])
    const beforeAttempt = async () => {
      throw new Error('ledger unavailable')
    }
    const outcome = await sendClefRequest(request({ beforeAttempt }), deps)
    expect(outcome).toMatchObject({
      blocker: unavailable('budget_exhausted'),
      errorClass: 'vetoed',
      attempts: 0
    })
    expect(deps.client.calls).toEqual([])
  })
})

describe('sendClefRequest local refusals', () => {
  it.each([
    ['another model', fixtureBody({ model: 'clef-flash' })],
    ['images', fixtureBody({ images: ['x'] })],
    ['options', fixtureBody({ options: {} })],
    ['bytes that are not JSON', new TextEncoder().encode('not json')]
  ])('refuses a body with %s before any budget or network work', async (_label, body) => {
    const deps = fixtureDeps([])
    const beforeAttempt = vi.fn(() => ({ proceed: true as const }))
    const outcome = await sendClefRequest(request({ body, beforeAttempt }), deps)
    expect(outcome).toMatchObject({
      blocker: unavailable('request_rejected'),
      errorClass: 'request_invalid',
      attempts: 0
    })
    expect(beforeAttempt).not.toHaveBeenCalled()
    expect(deps.client.calls).toEqual([])
  })

  it.each([
    ['a malformed account path', fixtureCredentials({ accountPath: () => 'not-an-account' })],
    ['a header without Bearer', fixtureCredentials({ authorizationHeader: () => 'Basic abc' })],
    [
      'a header with a line break',
      fixtureCredentials({ authorizationHeader: () => `Bearer ${FIXTURE_ONLY_TOKEN}\r\nX: y` })
    ],
    [
      'a throwing handle',
      fixtureCredentials({
        authorizationHeader: () => {
          throw new Error('cleared')
        }
      })
    ]
  ])('blocks as not_configured with %s', async (_label, credentials) => {
    const deps = fixtureDeps([])
    const outcome = await sendClefRequest(request({ credentials }), deps)
    expect(outcome).toMatchObject({
      blocker: unavailable('not_configured'),
      errorClass: 'credentials_unavailable',
      attempts: 0
    })
    expect(deps.client.calls).toEqual([])
  })
})

describe('sendClefRequest redaction and proxy', () => {
  it('keeps live secrets out of spans and the returned outcome', async () => {
    const records: unknown[] = []
    setActiveSink({ push: (record) => records.push(record), flush: () => {}, close: () => {} })
    const leaky = new TypeError(`fetch ${FIXTURE_ONLY_RUN_URL} failed`, {
      cause: new Error(`Authorization: Bearer ${FIXTURE_ONLY_TOKEN} for ${FIXTURE_ONLY_ACCOUNT_ID}`)
    })
    const deps = fixtureDeps([{ throws: leaky }, { throws: leaky }])
    const outcome = await sendClefRequest(request(), deps)

    const serialized = JSON.stringify([records, outcome])
    expect(records.length).toBeGreaterThan(0)
    expect(serialized).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(serialized).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(serialized).toContain('clef.transport')
    expect(serialized).toContain('clef.attempt_failed')
    expect(serialized).toContain('[redacted]')
  })

  it('prepares the proxy with the origin only and the client session', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    const { prepareProxy: _injected, ...withDefaultProxy } = deps
    await sendClefRequest(request(), withDefaultProxy)
    expect(ensureProxy).toHaveBeenCalledWith({ probeUrl: 'https://api.cloudflare.com/' })
  })

  it('still sends when proxy setup fails', async () => {
    ensureProxy.mockRejectedValueOnce(new Error(`proxy broke at ${FIXTURE_ONLY_RUN_URL}`))
    const deps = fixtureDeps([{ status: 200 }])
    const { prepareProxy: _injected, ...withDefaultProxy } = deps
    const outcome = await sendClefRequest(request(), withDefaultProxy)
    expect(outcome.kind).toBe('response')
  })

  it('turns an unexpected internal failure into a redacted blocked outcome', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    deps.random = () => {
      throw new Error(`random broke ${FIXTURE_ONLY_TOKEN}`)
    }
    const outcome = await sendClefRequest(request(), {
      ...deps,
      client: { ...deps.client, fetch: async () => new Response(null, { status: 500 }) }
    })
    expect(outcome).toMatchObject({
      blocker: unavailable('transient_exhausted'),
      errorClass: 'internal'
    })
    expect(JSON.stringify(outcome)).not.toContain(FIXTURE_ONLY_TOKEN)
  })
})

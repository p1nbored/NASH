import { afterEach, describe, expect, it } from 'vitest'
import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import { setMainHttpClient } from '../network/http-client'
import type { ClefLatchKind } from './clef-error-mapping'
import { CLEF_DEFAULT_MAX_ATTEMPTS, sendClefRequest } from './clef-transport'
import {
  FIXTURE_ONLY_RUN_URL,
  FIXTURE_ONLY_TOKEN,
  allowEveryAttempt,
  createFakeClient,
  fixtureBody,
  fixtureCredentials,
  fixtureDeps,
  type FakeStep
} from './clef-transport.test-fixture'

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

function expectEveryBodyConsumed(responses: readonly Response[]): void {
  expect(responses.length).toBeGreaterThan(0)
  for (const response of responses) {
    expect(response.bodyUsed).toBe(true)
  }
}

afterEach(() => {
  setMainHttpClient(null)
})

describe('sendClefRequest on success', () => {
  it('returns the raw response bytes and status for the validator', async () => {
    const deps = fixtureDeps([{ status: 200, body: '{"model":"clef","answers":{}}' }])
    const outcome = await sendClefRequest(request(), deps)

    expect(outcome.kind).toBe('response')
    expect(outcome.kind === 'response' && new TextDecoder().decode(outcome.bytes)).toBe(
      '{"model":"clef","answers":{}}'
    )
    expect(outcome).toMatchObject({ status: 200, attempts: 1 })
    expectEveryBodyConsumed(deps.client.responses)
    expect(deps.timers.pending()).toEqual([])
  })

  it('posts the pinned body to the concrete URL with a locked-down request init', async () => {
    const body = fixtureBody()
    const deps = fixtureDeps([{ status: 200 }])
    await sendClefRequest(request({ body }), deps)

    expect(deps.client.calls).toHaveLength(1)
    const [{ url, init }] = deps.client.calls
    expect(url).toBe(FIXTURE_ONLY_RUN_URL)
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      body
    })
    expect(init.headers).toEqual({
      Authorization: `Bearer ${FIXTURE_ONLY_TOKEN}`,
      'Content-Type': 'application/json'
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(deps.proxyPreparations).toBe(1)
  })

  it('sends the bytes it checked even if the caller reuses its buffer mid-call', async () => {
    const body = fixtureBody()
    const original = new TextDecoder().decode(body)
    const deps = fixtureDeps([{ status: 503 }, { status: 200 }])
    deps.prepareProxy = async () => body.fill(0x20)
    await sendClefRequest(request({ body }), deps)

    expect(deps.client.calls).toHaveLength(2)
    for (const { init } of deps.client.calls) {
      expect(init.body).not.toBe(body)
      expect(init.body instanceof Uint8Array && new TextDecoder().decode(init.body)).toBe(original)
    }
  })

  it('uses the installed main HTTP client when none is injected', async () => {
    const client = createFakeClient([{ status: 200 }])
    setMainHttpClient(client)
    const { client: _unused, ...withoutClient } = fixtureDeps([])
    const outcome = await sendClefRequest(request(), withoutClient)
    expect(outcome.kind).toBe('response')
    expect(client.calls).toHaveLength(1)
  })
})

describe('sendClefRequest error rows', () => {
  it.each<[number, RouteBlockerDetail, ClefLatchKind | null]>([
    [400, 'request_rejected', null],
    [401, 'auth_or_account', 'auth_failed'],
    [403, 'auth_or_account', 'auth_failed'],
    [404, 'model_unavailable', null],
    [413, 'request_rejected', null],
    [429, 'quota_exhausted', 'quota_latched'],
    [418, 'request_rejected', null],
    [302, 'request_rejected', null],
    [307, 'request_rejected', null]
  ])('maps %i once, with no retry and the body cancelled', async (status, detail, latch) => {
    const deps = fixtureDeps([{ status }, { status: 200 }])
    const outcome = await sendClefRequest(request(), deps)

    expect(outcome).toEqual({
      kind: 'blocked',
      blocker: unavailable(detail),
      latch,
      status,
      errorClass: 'http_status',
      attempts: 1
    })
    expect(deps.client.calls).toHaveLength(1)
    expect(deps.sleeps).toEqual([])
    expectEveryBodyConsumed(deps.client.responses)
  })

  it.each([500, 502, 503, 504, 408])(
    'retries %i once and then reports transient_exhausted',
    async (status) => {
      const deps = fixtureDeps([{ status }, { status }, { status: 200 }])
      const outcome = await sendClefRequest(request(), deps)

      expect(outcome).toEqual({
        kind: 'blocked',
        blocker: unavailable('transient_exhausted'),
        latch: null,
        status,
        errorClass: 'http_status',
        attempts: 2
      })
      expect(deps.client.calls).toHaveLength(2)
      expect(deps.sleeps).toHaveLength(1)
      expectEveryBodyConsumed(deps.client.responses)
    }
  )

  it('returns the response when a retry succeeds', async () => {
    const deps = fixtureDeps([{ status: 503 }, { status: 200, body: '{}' }])
    const outcome = await sendClefRequest(request(), deps)
    expect(outcome).toMatchObject({ kind: 'response', status: 200, attempts: 2 })
    expectEveryBodyConsumed(deps.client.responses)
  })

  it('retries a transport error and succeeds', async () => {
    const deps = fixtureDeps([{ throws: new TypeError('fetch failed') }, { status: 200 }])
    expect(await sendClefRequest(request(), deps)).toMatchObject({ kind: 'response', attempts: 2 })
  })

  it('reports transient_exhausted after transport errors on every attempt', async () => {
    const steps: FakeStep[] = [{ throws: new TypeError('fetch failed') }, { throws: 'socket' }]
    const outcome = await sendClefRequest(request(), fixtureDeps(steps))
    expect(outcome).toEqual({
      kind: 'blocked',
      blocker: unavailable('transient_exhausted'),
      latch: null,
      status: null,
      errorClass: 'network',
      attempts: 2
    })
  })

  it('never retries a refused redirect', async () => {
    const refused = new TypeError('fetch failed', {
      cause: new Error('redirect mode is set to error')
    })
    const deps = fixtureDeps([{ throws: refused }, { status: 200 }])
    const outcome = await sendClefRequest(request(), deps)
    expect(outcome).toMatchObject({
      kind: 'blocked',
      blocker: unavailable('request_rejected'),
      errorClass: 'redirect_refused',
      attempts: 1
    })
    expect(deps.client.calls).toHaveLength(1)
  })

  it('retries when a 200 body fails mid-read, cancelling the broken body', async () => {
    const deps = fixtureDeps([
      { status: 200, brokenBody: true },
      { status: 200, body: '{}' }
    ])
    const outcome = await sendClefRequest(request(), deps)
    expect(outcome).toMatchObject({ kind: 'response', attempts: 2 })
    expectEveryBodyConsumed(deps.client.responses)
  })

  it('reports a broken body on the last attempt as transient with its status', async () => {
    const deps = fixtureDeps([{ status: 200, brokenBody: true }], 0.5)
    const outcome = await sendClefRequest(request({ maxAttempts: 1 }), deps)
    expect(outcome).toMatchObject({
      kind: 'blocked',
      blocker: unavailable('transient_exhausted'),
      status: 200,
      errorClass: 'network',
      attempts: 1
    })
  })
})

describe('sendClefRequest retry budget and jitter', () => {
  it('keeps the one retry delay inside the first full-jitter window', async () => {
    const deps = fixtureDeps([{ status: 500 }, { status: 500 }], 0.999_999)
    const outcome = await sendClefRequest(request(), deps)
    expect(outcome).toMatchObject({ attempts: 2 })
    expect(deps.sleeps).toEqual([499])
  })

  it('draws the lowest delay when the random source returns zero', async () => {
    const deps = fixtureDeps([{ status: 500 }, { status: 500 }], 0)
    await sendClefRequest(request(), deps)
    expect(deps.sleeps).toEqual([0])
  })

  it.each([3, 5, 100, Number.MAX_SAFE_INTEGER])(
    'never bills more than the D-012 default of two attempts, even when asked for %s',
    async (maxAttempts) => {
      const asked: number[] = []
      const beforeAttempt = (attempt: number) => {
        asked.push(attempt)
        return { proceed: true as const }
      }
      const steps: FakeStep[] = Array.from({ length: 6 }, () => ({ status: 500 }))
      const deps = fixtureDeps(steps)
      const outcome = await sendClefRequest(request({ maxAttempts, beforeAttempt }), deps)
      expect(outcome).toMatchObject({ kind: 'blocked', attempts: 2 })
      expect(deps.client.calls).toHaveLength(2)
      expect(asked).toEqual([1, 2])
    }
  )

  it('lets the caller lower the budget to one attempt and defaults to two', async () => {
    const one = fixtureDeps([{ status: 500 }, { status: 200 }])
    expect(await sendClefRequest(request({ maxAttempts: 1 }), one)).toMatchObject({ attempts: 1 })
    expect(one.client.calls).toHaveLength(1)
    const defaulted = fixtureDeps([{ status: 500 }, { status: 500 }, { status: 200 }])
    expect(await sendClefRequest(request(), defaulted)).toMatchObject({ attempts: 2 })
    expect(CLEF_DEFAULT_MAX_ATTEMPTS).toBe(2)
  })

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses an invalid attempt budget %s with no call',
    async (maxAttempts) => {
      const deps = fixtureDeps([])
      const outcome = await sendClefRequest(request({ maxAttempts }), deps)
      expect(outcome).toMatchObject({
        kind: 'blocked',
        blocker: unavailable('budget_exhausted'),
        errorClass: 'vetoed',
        attempts: 0
      })
      expect(deps.client.calls).toEqual([])
    }
  )
})

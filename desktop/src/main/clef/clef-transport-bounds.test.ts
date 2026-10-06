import { describe, expect, it, vi } from 'vitest'
import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import { WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES } from '../runtime/orchestration/db/workbench-route-schema-definition'
import { sendClefRequest } from './clef-transport'
import { CLEF_RESPONSE_BODY_MAX_BYTES } from './clef-transport-body'
import { clefCallOutcomeFor } from './clef-transport-outcome'
import { CLEF_OVERALL_DEADLINE_MS } from './clef-transport-signals'
import {
  allowEveryAttempt,
  fixtureBody,
  fixtureCredentials,
  fixtureDeps
} from './clef-transport.test-fixture'

const CHUNK_BYTES = 65_536
const CHUNKS_AT_LIMIT = CLEF_RESPONSE_BODY_MAX_BYTES / CHUNK_BYTES
const NEVER = (): Promise<never> => new Promise(() => {})

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

const DEADLINE_BLOCKED = {
  kind: 'blocked',
  blocker: unavailable('transient_exhausted'),
  latch: null,
  errorClass: 'deadline'
} as const

describe('sendClefRequest proxy preparation bounds', () => {
  it('ends at the 30 s deadline when proxy preparation never settles', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    deps.prepareProxy = NEVER
    const beforeAttempt = vi.fn(allowEveryAttempt)
    const pending = sendClefRequest(request({ beforeAttempt }), deps)
    await vi.waitFor(() => expect(deps.timers.pending()).toHaveLength(1))
    expect(deps.timers.pending()[0].ms).toBe(CLEF_OVERALL_DEADLINE_MS)
    deps.timers.pending()[0].fire()

    expect(await pending).toEqual({ ...DEADLINE_BLOCKED, status: null, attempts: 0 })
    expect(deps.client.calls).toEqual([])
    expect(beforeAttempt).not.toHaveBeenCalled()
    expect(deps.timers.pending()).toEqual([])
  })

  it('returns aborted when the caller aborts while proxy preparation hangs', async () => {
    const controller = new AbortController()
    const deps = fixtureDeps([{ status: 200 }])
    deps.prepareProxy = NEVER
    const pending = sendClefRequest(request({ signal: controller.signal }), deps)
    await vi.waitFor(() => expect(deps.timers.pending()).toHaveLength(1))
    controller.abort()

    expect(await pending).toEqual({ kind: 'aborted', attempts: 0 })
    expect(deps.client.calls).toEqual([])
    expect(deps.timers.pending()).toEqual([])
  })

  it('treats a synchronous proxy preparation throw like any other setup failure', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    deps.prepareProxy = () => {
      throw new Error('proxy setup threw')
    }
    expect((await sendClefRequest(request(), deps)).kind).toBe('response')
  })
})

describe('sendClefRequest budget hook bounds', () => {
  it('ends at the deadline when the first budget hook never settles', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    const beforeAttempt = vi.fn(NEVER)
    const pending = sendClefRequest(request({ beforeAttempt }), deps)
    await vi.waitFor(() => expect(beforeAttempt).toHaveBeenCalledTimes(1))
    deps.timers.pending()[0].fire()

    expect(await pending).toEqual({ ...DEADLINE_BLOCKED, status: null, attempts: 0 })
    expect(deps.client.calls).toEqual([])
  })

  it('returns aborted when the caller aborts while the budget hook hangs', async () => {
    const controller = new AbortController()
    const deps = fixtureDeps([{ status: 200 }])
    const beforeAttempt = vi.fn(NEVER)
    const pending = sendClefRequest(request({ beforeAttempt, signal: controller.signal }), deps)
    await vi.waitFor(() => expect(beforeAttempt).toHaveBeenCalledTimes(1))
    controller.abort()

    expect(await pending).toEqual({ kind: 'aborted', attempts: 0 })
    expect(deps.client.calls).toEqual([])
    expect(deps.timers.pending()).toEqual([])
  })

  it('ends at the deadline when the retry hook hangs, keeping the attempts and last status', async () => {
    const deps = fixtureDeps([{ status: 503 }, { status: 200 }])
    const beforeAttempt = vi.fn((attempt: number) =>
      attempt === 1 ? { proceed: true as const } : NEVER()
    )
    const pending = sendClefRequest(request({ beforeAttempt }), deps)
    await vi.waitFor(() => expect(beforeAttempt).toHaveBeenCalledTimes(2))
    deps.timers.pending()[0].fire()

    expect(await pending).toEqual({ ...DEADLINE_BLOCKED, status: 503, attempts: 1 })
    expect(deps.client.calls).toHaveLength(1)
  })

  it('sends nothing for a permit that only arrives after the deadline', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    let grant: (permit: { proceed: true }) => void = () => {}
    const beforeAttempt = vi.fn(
      () => new Promise<{ proceed: true }>((resolve) => (grant = resolve))
    )
    const pending = sendClefRequest(request({ beforeAttempt }), deps)
    await vi.waitFor(() => expect(beforeAttempt).toHaveBeenCalledTimes(1))
    deps.timers.pending()[0].fire()
    await pending
    grant({ proceed: true })
    await Promise.resolve()

    expect(deps.client.calls).toEqual([])
  })
})

describe('sendClefRequest required budget hook', () => {
  const vetoed = {
    kind: 'blocked',
    blocker: unavailable('budget_exhausted'),
    latch: null,
    status: null,
    errorClass: 'vetoed',
    attempts: 0
  }

  it('refuses a call that carries no budget hook, with no proxy or network work', async () => {
    const deps = fixtureDeps([{ status: 200 }])
    const { beforeAttempt: _omitted, ...withoutHook } = request()
    // @ts-expect-error -- beforeAttempt is required, so a billed call cannot skip the ledger.
    const outcome = await sendClefRequest(withoutHook, deps)

    expect(outcome).toEqual(vetoed)
    expect(deps.client.calls).toEqual([])
    expect(deps.proxyPreparations).toBe(0)
  })

  it.each([undefined, null, 'proceed', {}])(
    'refuses a budget hook that is %j at run time',
    async (notAHook) => {
      const deps = fixtureDeps([{ status: 200 }])
      const outcome = await sendClefRequest(
        Object.assign(request(), { beforeAttempt: notAHook }),
        deps
      )
      expect(outcome).toEqual(vetoed)
      expect(deps.client.calls).toEqual([])
    }
  )
})

describe('sendClefRequest response body cap', () => {
  const oversizedBlocker: RouteBlocker = {
    reason: 'invalid_output',
    detail: 'response_schema_violation'
  }

  it('uses the same limit as the persistence layer', () => {
    expect(CLEF_RESPONSE_BODY_MAX_BYTES).toBe(WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES)
    expect(CLEF_RESPONSE_BODY_MAX_BYTES).toBe(1_048_576)
  })

  it('returns a body of exactly the limit untouched', async () => {
    const streamed = { chunkBytes: CHUNK_BYTES, chunkCount: CHUNKS_AT_LIMIT }
    const outcome = await sendClefRequest(request(), fixtureDeps([{ status: 200, streamed }]))
    expect(outcome).toMatchObject({ kind: 'response', status: 200, attempts: 1 })
    expect(outcome.kind === 'response' && outcome.bytes.byteLength).toBe(
      CLEF_RESPONSE_BODY_MAX_BYTES
    )
  })

  it('stops reading one chunk past the limit and blocks without keeping any of the body', async () => {
    const pulled = vi.fn()
    const cancelled = vi.fn()
    const streamed = {
      chunkBytes: CHUNK_BYTES,
      chunkCount: 10_000,
      onPull: pulled,
      onCancel: cancelled
    }
    const deps = fixtureDeps([{ status: 200, streamed }, { status: 200 }])
    const outcome = await sendClefRequest(request(), deps)

    expect(outcome).toEqual({
      kind: 'blocked',
      blocker: oversizedBlocker,
      latch: null,
      status: 200,
      errorClass: 'response_too_large',
      attempts: 1
    })
    expect(pulled).toHaveBeenCalledTimes(CHUNKS_AT_LIMIT + 1)
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(deps.client.calls).toHaveLength(1)
    expect(deps.client.responses[0].bodyUsed).toBe(true)
    expect(Object.keys(outcome)).not.toContain('bytes')
  })

  it('refuses a declared Content-Length over the limit without reading any of the body', async () => {
    const pulled = vi.fn()
    const cancelled = vi.fn()
    const streamed = { chunkBytes: 16, chunkCount: 4, onPull: pulled, onCancel: cancelled }
    const headers = { 'content-length': String(CLEF_RESPONSE_BODY_MAX_BYTES + 1) }
    const outcome = await sendClefRequest(
      request(),
      fixtureDeps([{ status: 200, streamed, headers }])
    )

    expect(outcome).toMatchObject({ errorClass: 'response_too_large', attempts: 1 })
    expect(pulled).not.toHaveBeenCalled()
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('refuses a 16-digit declared Content-Length over the limit without reading', async () => {
    const pulled = vi.fn()
    const streamed = { chunkBytes: 16, chunkCount: 1, onPull: pulled }
    const headers = { 'content-length': '1000000000000000' }
    const outcome = await sendClefRequest(
      request(),
      fixtureDeps([{ status: 200, streamed, headers }])
    )

    expect(outcome).toMatchObject({ errorClass: 'response_too_large', attempts: 1 })
    expect(pulled).not.toHaveBeenCalled()
  })

  it('does not trust a small declared length when the body keeps coming', async () => {
    const pulled = vi.fn()
    const streamed = { chunkBytes: CHUNK_BYTES, chunkCount: 10_000, onPull: pulled }
    const headers = { 'content-length': '10' }
    const outcome = await sendClefRequest(
      request(),
      fixtureDeps([{ status: 200, streamed, headers }])
    )

    expect(outcome).toMatchObject({ errorClass: 'response_too_large' })
    expect(pulled).toHaveBeenCalledTimes(CHUNKS_AT_LIMIT + 1)
  })

  it.each(['abc', '-5', '1e3', ''])(
    'ignores a malformed Content-Length of %j and reads the body normally',
    async (declared) => {
      const headers = { 'content-length': declared }
      const outcome = await sendClefRequest(
        request(),
        fixtureDeps([{ status: 200, body: '{"ok":true}', headers }])
      )
      expect(outcome).toMatchObject({ kind: 'response', status: 200 })
    }
  )

  it('never tells the circuit an oversized body was a transient outage', async () => {
    const streamed = { chunkBytes: CHUNK_BYTES, chunkCount: 10_000 }
    const outcome = await sendClefRequest(request(), fixtureDeps([{ status: 200, streamed }]))
    expect(clefCallOutcomeFor(outcome)).toBe('other_failure')
  })
})

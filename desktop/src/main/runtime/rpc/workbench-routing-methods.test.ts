import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseClefProfilePinResult,
  parseClefVerifyResult
} from '../../../shared/clef/clef-verification-view'
import { parseWorkbenchRoutingStatusView } from '../../../shared/clef/workbench-routing-status-view'
import { WorkbenchSubmitResultSchema } from '../../../shared/workbench-request'
import { issueWorkbenchDesktopCaller } from '../workbench-caller'
import {
  createWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime
} from '../workbench-routing/workbench-routing-runtime'
import {
  FIXTURE_ONLY_WORKSPACE,
  createRuntimeHarness,
  type RuntimeHarness
} from '../workbench-routing/workbench-runtime.test-fixture'
import { RpcDispatcher, type DispatcherOptions } from './dispatcher'
import type { RpcResponse } from './core'
import { ALL_RPC_METHODS } from './methods'
import { WORKBENCH_METHODS } from './methods/workbench'

const caller = issueWorkbenchDesktopCaller()
const workspaceId = FIXTURE_ONLY_WORKSPACE.workspaceId

let harness: RuntimeHarness

beforeEach(() => {
  harness = createRuntimeHarness()
  install()
})

afterEach(() => {
  setWorkbenchRoutingRuntime(null)
  harness.close()
})

function install(): void {
  setWorkbenchRoutingRuntime(
    createWorkbenchRoutingRuntime({ ...harness.deps, admin: harness.admin })
  )
}

async function call(
  method: string,
  params?: unknown,
  methods: DispatcherOptions['methods'] = WORKBENCH_METHODS
): Promise<RpcResponse> {
  const runtime = {
    getRuntimeId: vi.fn(() => 'fixture-runtime'),
    requireWorkbenchWorkspace: vi.fn(() => FIXTURE_ONLY_WORKSPACE),
    getOrchestrationDb: vi.fn(() => harness.owner)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the exercised Workbench methods read this fixture's runtime members.
  const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods })
  return dispatcher.dispatch(
    { id: 'fixture-request', authToken: 'fixture-local-token', method, params },
    { workbenchCaller: caller }
  )
}

function resultOf(response: RpcResponse): unknown {
  if (!response.ok) {
    throw new Error(`expected success, got ${response.error.code}`)
  }
  return response.result
}

describe('retired intake routing methods', () => {
  const REMOVED = [
    ['workbench.route.retry', { workspaceId, requestId: 'request-one', expectedRevision: 1 }],
    ['workbench.route.decision.get', { workspaceId, requestId: 'request-one' }]
  ] as const

  it.each(REMOVED)(
    'answers method_not_found for %s on the Workbench registry',
    async (name, params) => {
      expect(await call(name, params)).toMatchObject({
        ok: false,
        error: { code: 'method_not_found' }
      })
    }
  )

  it.each(REMOVED)('answers method_not_found for %s on the full registry', async (name, params) => {
    expect(await call(name, params, ALL_RPC_METHODS)).toMatchObject({
      ok: false,
      error: { code: 'method_not_found' }
    })
  })

  it.each(REMOVED)(
    'answers method_not_found for %s even without a desktop caller',
    async (name, params) => {
      const runtime = {
        getRuntimeId: vi.fn(() => 'fixture-runtime'),
        requireWorkbenchWorkspace: vi.fn(),
        getOrchestrationDb: vi.fn()
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a missing method never reads the runtime.
      const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
      const response = await dispatcher.dispatch({
        id: 'fixture-request',
        authToken: 'fixture-local-token',
        method: name,
        params
      })
      expect(response).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
      expect(runtime.requireWorkbenchWorkspace).not.toHaveBeenCalled()
      expect(runtime.getOrchestrationDb).not.toHaveBeenCalled()
    }
  )

  it('registers exactly the surviving Workbench methods', () => {
    expect(WORKBENCH_METHODS.map((method) => method.name).sort()).toEqual([
      'workbench.clef.profile.pin',
      'workbench.clef.verify',
      'workbench.requests.cancel',
      'workbench.requests.list',
      'workbench.requests.submit',
      'workbench.routing.status'
    ])
  })

  it('starts nothing, calls nothing and reserves nothing when a removed method is asked', async () => {
    await call('workbench.route.retry', { workspaceId, requestId: 'x', expectedRevision: 1 })
    expect(harness.transport).not.toHaveBeenCalled()
    expect(harness.spendRows()).toEqual([])
  })
})

describe('workbench.requests.submit through the surviving registry', () => {
  it('records the request as received and makes no Clef call even with a ready runtime', async () => {
    const response = await call('workbench.requests.submit', {
      workspaceId,
      objective: 'Add a retry button to the Workbench queue.',
      idempotencyKey: randomUUID()
    })
    // Why ROUTING: the v3 view shows a RECEIVED request, not yet launched, as ROUTING (D-016 section 1.2).
    expect(resultOf(response)).toMatchObject({
      duplicate: false,
      request: { status: 'ROUTING', routingBlocker: null, workflowRunId: null }
    })
    expect(harness.transport).not.toHaveBeenCalled()
    expect(harness.spendRows()).toEqual([])
  })

  it('lists and cancels what it submitted', async () => {
    const submitted = WorkbenchSubmitResultSchema.parse(
      resultOf(
        await call('workbench.requests.submit', {
          workspaceId,
          objective: 'Inspect this change.',
          idempotencyKey: randomUUID()
        })
      )
    )
    const listed = resultOf(await call('workbench.requests.list', { workspaceId, limit: 10 }))
    expect(JSON.stringify(listed)).toContain(submitted.request.requestId)
    expect(listed).toMatchObject({ blocker: 'not_configured' })
    const canceled = await call('workbench.requests.cancel', {
      workspaceId,
      requestId: submitted.request.requestId,
      expectedRevision: submitted.request.revision
    })
    expect(resultOf(canceled)).toMatchObject({ changed: true, request: { status: 'CANCELED' } })
  })
})

describe('workbench.routing.status', () => {
  it('answers the secret-free status view and spends nothing', async () => {
    const result = parseWorkbenchRoutingStatusView(resultOf(await call('workbench.routing.status')))
    expect(result).toMatchObject({ status: 'ready', dispatch: false })
    // Why: D-022 removed the spend caps, so the status carries no budget.
    expect(Object.keys(result ?? {})).not.toContain('caps')
    expect(harness.transport).not.toHaveBeenCalled()
    expect(harness.spendRows()).toEqual([])
  })

  it('refuses when no routing runtime is installed', async () => {
    setWorkbenchRoutingRuntime(null)
    expect(await call('workbench.routing.status')).toMatchObject({
      ok: false,
      error: { code: 'workbench_routing_not_configured' }
    })
  })
})

describe('workbench.clef.verify', () => {
  it('runs the one verification call and answers the redacted report, with no cost', async () => {
    const result = parseClefVerifyResult(resultOf(await call('workbench.clef.verify')))
    expect(result).toMatchObject({ outcome: 'reported', pin: { pinnable: true } })
    expect(Object.keys(result ?? {})).not.toContain('cost')
    expect(harness.transport).toHaveBeenCalledTimes(1)
    expect(harness.spendRows()).toMatchObject([{ purpose: 'verification', request_id: null }])
  })

  it('fails closed with a clear code when credentials are missing, and spends nothing', async () => {
    harness.credentials.setStatus({
      tokenPresent: false,
      accountPresent: false,
      protection: 'absent'
    })
    expect(await call('workbench.clef.verify')).toMatchObject({
      ok: false,
      error: { code: 'workbench_clef_credentials_missing' }
    })
    expect(harness.transport).not.toHaveBeenCalled()
    expect(harness.spendRows()).toEqual([])
  })

  it('accepts no parameters', async () => {
    expect(await call('workbench.clef.verify', { objective: 'Inspect.' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(harness.transport).not.toHaveBeenCalled()
  })

  it('refuses when no routing runtime is installed', async () => {
    setWorkbenchRoutingRuntime(null)
    expect(await call('workbench.clef.verify')).toMatchObject({
      ok: false,
      error: { code: 'workbench_routing_not_configured' }
    })
  })
})

describe('workbench.clef.profile.pin', () => {
  it('writes the profile only for the report the user confirmed', async () => {
    const verified = parseClefVerifyResult(resultOf(await call('workbench.clef.verify')))
    if (verified?.outcome !== 'reported') {
      throw new Error('the fixture verification must produce a report')
    }
    const pinned = parseClefProfilePinResult(
      resultOf(await call('workbench.clef.profile.pin', { reportSha256: verified.reportSha256 }))
    )
    expect(pinned).toMatchObject({ pinned: true, routingStatus: 'ready' })
    expect(harness.profileWrites).toHaveLength(1)
    expect(harness.profileWrites[0]?.reportSha256).toBe(verified.reportSha256)
  })

  it('refuses a hash that is not the held report, and a malformed hash', async () => {
    await call('workbench.clef.verify')
    expect(
      await call('workbench.clef.profile.pin', { reportSha256: 'f'.repeat(64) })
    ).toMatchObject({ ok: false, error: { code: 'workbench_clef_report_unconfirmed' } })
    expect(await call('workbench.clef.profile.pin', { reportSha256: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(
      await call('workbench.clef.profile.pin', {
        reportSha256: 'f'.repeat(64),
        profile: { envelopeMode: 'bare' }
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(harness.profileWrites).toEqual([])
  })

  it('refuses before any verification has run', async () => {
    expect(
      await call('workbench.clef.profile.pin', { reportSha256: 'a'.repeat(64) })
    ).toMatchObject({ ok: false, error: { code: 'workbench_clef_report_unconfirmed' } })
    expect(harness.profileWrites).toEqual([])
  })
})

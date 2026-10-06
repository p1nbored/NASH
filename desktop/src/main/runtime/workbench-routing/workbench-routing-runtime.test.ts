import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeClefRoutingStatus } from '../../clef/clef-routing-status'
import {
  createWorkbenchRoutingRuntime,
  getWorkbenchRoutingRuntime,
  requireWorkbenchRoutingRuntime,
  setWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from './workbench-routing-runtime'
import {
  createRuntimeHarness,
  transportHangingUntilAborted,
  type RuntimeHarness
} from './workbench-runtime.test-fixture'
import { FIXTURE_ONLY_SEALED_STATUS, fixtureProfileRecord } from './workbench-routing.test-fixture'

let harness: RuntimeHarness | null = null

function setup(options: Parameters<typeof createRuntimeHarness>[0] = {}) {
  harness = createRuntimeHarness(options)
  return harness
}

function runtimeOf(h: RuntimeHarness): WorkbenchRoutingRuntime {
  return createWorkbenchRoutingRuntime({ ...h.deps, admin: h.admin })
}

afterEach(() => {
  harness?.close()
  harness = null
  setWorkbenchRoutingRuntime(null)
})

describe('createWorkbenchRoutingRuntime: no intake routing under D-016', () => {
  it('offers only status, verification, pin and shutdown control, and no routing member', () => {
    const runtime = runtimeOf(setup())
    expect(Object.keys(runtime).sort()).toEqual([
      'abortAllRouting',
      'pinClefProfile',
      'reportFailure',
      'routingStatusView',
      'verifyClef'
    ])
  })

  it('builds and answers status without a router, an eligibility source or a decision cache', () => {
    const h = setup()
    // Why no extra deps: the runtime is built from the Clef ports alone, so nothing can route a request.
    expect(Object.keys(h.deps).sort()).toEqual([
      'aborts',
      'clock',
      'credentials',
      'ledger',
      'transport',
      'verifiedProfile'
    ])
    expect(runtimeOf(h).routingStatusView().status).toBe('ready')
    expect(h.transport).not.toHaveBeenCalled()
    expect(h.spendRows()).toEqual([])
  })
})

describe('createWorkbenchRoutingRuntime: status from local state', () => {
  it('reports ready with dispatch off, because no handoff exists yet', () => {
    const view = runtimeOf(setup()).routingStatusView()
    expect(view).toMatchObject({ status: 'ready', dispatch: false })
  })

  it.each([
    [
      'not_configured',
      (h: RuntimeHarness) =>
        h.credentials.setStatus({
          tokenPresent: false,
          accountPresent: false,
          protection: 'absent'
        })
    ],
    [
      'sealing_unavailable',
      (h: RuntimeHarness) =>
        h.credentials.setStatus({
          ...FIXTURE_ONLY_SEALED_STATUS,
          protection: 'sealing_unavailable'
        })
    ],
    ['contract_unverified', (h: RuntimeHarness) => h.setProfile(null)],
    [
      'identity_unpinned',
      (h: RuntimeHarness) => h.setProfile(fixtureProfileRecord({ expectedResponseModel: null }))
    ]
  ] as const)('reports %s from the same local state G0 reads', (status, change) => {
    const h = setup()
    change(h)
    expect(runtimeOf(h).routingStatusView().status).toBe(status)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('takes no spend caps, so no cap ever blocks Clef (D-022)', () => {
    const h = setup()
    expect(Object.keys(h.admin).sort()).toEqual(['profileStore', 'schemaPins', 'spend'])
    const view = runtimeOf(h).routingStatusView()
    expect(view.status).toBe('ready')
    expect(Object.keys(view)).not.toContain('caps')
  })

  it('reports the latches, the open circuit and an unreachable service from the circuit', () => {
    const h = setup()
    const runtime = runtimeOf(h)
    const generation = h.credentials.generation()
    h.circuit.record('transient_exhausted', generation)
    expect(runtime.routingStatusView().status).toBe('unreachable')
    h.circuit.record('transient_exhausted', generation)
    h.circuit.record('transient_exhausted', generation)
    expect(runtime.routingStatusView().status).toBe('circuit_open')
    h.circuit.record('success', generation)
    h.circuit.record('quota_latched', generation)
    expect(runtime.routingStatusView().status).toBe('quota_latched')
    h.circuit.record('auth_failed', generation)
    expect(runtime.routingStatusView().status).toBe('auth_failed')
    h.credentials.rotate()
    expect(runtime.routingStatusView().status).toBe('quota_latched')
  })

  describe('parity with computeClefRoutingStatus', () => {
    const parityInput = (
      profile: ReturnType<typeof fixtureProfileRecord>['profile'] | null,
      nowMs: number
    ) => ({
      credentials: { sealingAvailable: true, token: 'sealed', accountId: 'sealed' } as const,
      profile,
      latches: { authFailed: false, quotaUntilMs: null },
      circuit: { openUntilMs: null },
      lastCallOutcome: null,
      nowMs
    })

    it('agrees when everything is configured', () => {
      const h = setup()
      expect(runtimeOf(h).routingStatusView().status).toBe(
        computeClefRoutingStatus(parityInput(fixtureProfileRecord().profile, h.clock.ms))
      )
    })

    it('agrees when no profile is verified', () => {
      const h = setup({ profile: null })
      expect(runtimeOf(h).routingStatusView().status).toBe(
        computeClefRoutingStatus(parityInput(null, h.clock.ms))
      )
    })
  })
})

describe('createWorkbenchRoutingRuntime: shutdown and failure control', () => {
  it('aborts nothing when no call is in flight', () => {
    expect(runtimeOf(setup()).abortAllRouting()).toBe(0)
  })

  it('aborts the one in-flight verification call on shutdown', async () => {
    const h = setup()
    let markInFlight: () => void = () => undefined
    const inFlight = new Promise<void>((resolve) => {
      markInFlight = resolve
    })
    h.transport.mockImplementation(transportHangingUntilAborted(markInFlight))
    const runtime = runtimeOf(h)
    const pending = runtime.verifyClef()
    await inFlight
    expect(runtime.abortAllRouting()).toBe(1)
    expect(await pending).toMatchObject({
      outcome: 'call_failed',
      blocker: { detail: 'interrupted' }
    })
  })

  it('hands an unexpected failure to the installed reporter', () => {
    const h = setup()
    const onFailure = vi.fn()
    const runtime = createWorkbenchRoutingRuntime({ ...h.deps, onFailure })
    const error = new Error('boom')
    runtime.reportFailure(error)
    expect(onFailure).toHaveBeenCalledWith(error)
  })

  it('has a quiet default reporter, so a missing sink never breaks the failure path', () => {
    const h = setup()
    expect(() =>
      createWorkbenchRoutingRuntime(h.deps).reportFailure(new Error('boom'))
    ).not.toThrow()
  })
})

describe('the installed routing runtime', () => {
  it('is absent until the wiring installs one and can be removed again', () => {
    expect(getWorkbenchRoutingRuntime()).toBeNull()
    const runtime = runtimeOf(setup())
    setWorkbenchRoutingRuntime(runtime)
    expect(getWorkbenchRoutingRuntime()).toBe(runtime)
    setWorkbenchRoutingRuntime(null)
    expect(getWorkbenchRoutingRuntime()).toBeNull()
  })

  it('is required with a workbench error code when none is installed', () => {
    expect(() => requireWorkbenchRoutingRuntime()).toThrowError(
      expect.objectContaining({ code: 'workbench_routing_not_configured' })
    )
    const runtime = runtimeOf(setup())
    setWorkbenchRoutingRuntime(runtime)
    expect(requireWorkbenchRoutingRuntime()).toBe(runtime)
  })
})

describe('the Workbench request router', () => {
  const root = join(process.cwd(), 'src')

  function productionSources(): string[] {
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((path) => path.split(sep).join('/'))
      .filter((path) => /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path))
      .filter((path) => !path.endsWith('.test-fixture.ts'))
  }

  it('has no production importer, so no intake path can start a Clef classification', () => {
    const importers = productionSources()
      .filter((path) => path !== 'main/runtime/workbench-routing/workbench-request-router.ts')
      .filter((path) => /workbench-request-router['"]/.test(readFileSync(join(root, path), 'utf8')))
    expect(importers).toEqual([])
  })

  it('is not built by the startup install either, with its decision cache and eligibility source', () => {
    const importers = productionSources().filter((path) =>
      /route-(?:decision-cache|eligibility-production)['"]/.test(
        readFileSync(join(root, path), 'utf8')
      )
    )
    expect(importers.filter((path) => path.startsWith('main/startup/'))).toEqual([])
  })
})

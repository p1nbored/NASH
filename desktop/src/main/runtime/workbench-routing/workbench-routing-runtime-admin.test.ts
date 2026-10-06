import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRoutingStatusView } from './routing-status-view'
import {
  createWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from './workbench-routing-runtime'
import { createRuntimeHarness, type RuntimeHarness } from './workbench-runtime.test-fixture'

let harness: RuntimeHarness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

const ADMIN_CALLS: readonly (readonly [string, (runtime: WorkbenchRoutingRuntime) => unknown])[] = [
  ['routingStatusView', (runtime) => runtime.routingStatusView()],
  ['verifyClef', (runtime) => runtime.verifyClef()],
  ['pinClefProfile', (runtime) => runtime.pinClefProfile('a'.repeat(64))]
]

describe('routing runtime without the Clef administration wiring', () => {
  it.each(ADMIN_CALLS)(
    'fails closed on %s with a clear code instead of guessing',
    async (_name, call) => {
      harness = createRuntimeHarness()
      const runtime = createWorkbenchRoutingRuntime(harness.deps)
      await expect(Promise.resolve().then(() => call(runtime))).rejects.toMatchObject({
        code: 'workbench_clef_unavailable'
      })
      expect(harness.transport).not.toHaveBeenCalled()
    }
  )
})

describe('routing runtime with the Clef administration wiring', () => {
  it('serves the status view from local state only', () => {
    harness = createRuntimeHarness()
    const runtime = createWorkbenchRoutingRuntime({ ...harness.deps, admin: harness.admin })
    expect(runtime.routingStatusView()).toEqual(
      readRoutingStatusView(harness.deps, {
        dispatch: false,
        storedProfile: harness.admin.profileStore
      })
    )
    expect(runtime.routingStatusView().dispatch).toBe(false)
    expect(harness.transport).not.toHaveBeenCalled()
    expect(harness.spendRows()).toEqual([])
  })

  it('verifies through the shared ledger, transport and credentials', async () => {
    harness = createRuntimeHarness()
    const runtime = createWorkbenchRoutingRuntime({ ...harness.deps, admin: harness.admin })
    const result = await runtime.verifyClef()
    expect(result.outcome).toBe('reported')
    expect(harness.transport).toHaveBeenCalledTimes(1)
    expect(harness.spendRows()).toMatchObject([{ purpose: 'verification', request_id: null }])
  })

  it('pins a confirmed report and then reports the status the gates now see', async () => {
    harness = createRuntimeHarness({ profile: null })
    const runtime = createWorkbenchRoutingRuntime({ ...harness.deps, admin: harness.admin })
    expect(runtime.routingStatusView().status).toBe('contract_unverified')
    const verified = await runtime.verifyClef()
    if (verified.outcome !== 'reported') {
      throw new Error('the fixture verification must produce a report')
    }
    const pinned = runtime.pinClefProfile(verified.reportSha256)
    expect(harness.profileWrites).toHaveLength(1)
    expect(pinned.routingStatus).toBe('ready')
    expect(runtime.routingStatusView().status).toBe('ready')
  })

  it('hands a profile write failure to the failure sink without leaking it', async () => {
    harness = createRuntimeHarness()
    const onFailure = vi.fn()
    const write = vi.fn(() => {
      throw new Error('EBUSY: fixture disk error')
    })
    const runtime = createWorkbenchRoutingRuntime({
      ...harness.deps,
      admin: { ...harness.admin, profileStore: { ...harness.admin.profileStore, write } },
      onFailure
    })
    const verified = await runtime.verifyClef()
    if (verified.outcome !== 'reported') {
      throw new Error('the fixture verification must produce a report')
    }
    expect(() => runtime.pinClefProfile(verified.reportSha256)).toThrowError(
      expect.objectContaining({ code: 'workbench_clef_profile_write_failed' })
    )
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})

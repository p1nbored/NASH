import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DotStatusResultSchema } from '../../../shared/dot-ingress/dot-ingress-request'

import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { finishDotIntake, recoverDotIntake, submitDotRequest } from './dot-ingress-intake'
import {
  FIXTURE_BINDING,
  FIXTURE_WORKSPACE,
  createDotHarness,
  fixtureUuid,
  rejectionCodeOf,
  type DotHarness
} from './dot-ingress-service.test-fixture'
import { statusResult } from './dot-ingress-views'

// The admission policy is re-run right before every door submit: revoking dot (the switch, the
// workspace or its access maximum) stops every request the Workbench has not accepted yet.

const LATER = '2026-10-05T00:00:20.000Z'
const REVOCATIONS = ['global_off', 'workspace_off', 'lowered_ceiling'] as const
type Revocation = (typeof REVOCATIONS)[number]

const FAILURE_BY_REVOCATION = {
  global_off: 'intake_refused',
  workspace_off: 'workspace_unavailable',
  lowered_ceiling: 'intake_refused'
} as const satisfies Record<Revocation, string>

function revoke(harness: DotHarness, change: Revocation): void {
  const settings = getDotIngressSettingsStore(harness.owner)
  if (change === 'global_off') {
    settings.setEnabled({ enabled: false, timestamp: LATER })
  } else if (change === 'workspace_off') {
    settings.disableWorkspace({ workspaceRef: harness.workspaceRef, timestamp: LATER })
  } else {
    lowerCeiling(harness)
  }
}

function lowerCeiling(harness: DotHarness): void {
  getDotIngressSettingsStore(harness.owner).enableWorkspace({
    workspaceId: FIXTURE_WORKSPACE.workspaceId,
    workspaceBinding: FIXTURE_BINDING,
    label: 'fixture-repo',
    maxAccess: 'read_only',
    timestamp: LATER
  })
}

function restore(harness: DotHarness): void {
  const settings = getDotIngressSettingsStore(harness.owner)
  settings.setEnabled({ enabled: true, timestamp: LATER })
  settings.enableWorkspace({
    workspaceId: FIXTURE_WORKSPACE.workspaceId,
    workspaceBinding: FIXTURE_BINDING,
    label: 'fixture-repo',
    maxAccess: 'workspace_write',
    timestamp: LATER
  })
}

describe('dot intake recovery: revoking dot stops requests the Workbench has not accepted', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness({ maxAccess: 'workspace_write' })
  })
  afterEach(() => harness.close())

  async function receivedWriteRequest() {
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const request = harness.submitRequest({ requestedAccess: 'workspace_write' })
    const { record } = await submitDotRequest(harness.deps, request)
    expect(record.state).toBe('received')
    expect(harness.door.submits).toHaveLength(1)
    return { record, request }
  }

  it.each(REVOCATIONS)(
    'does not start a received request after %s, and settles it as refused',
    async (change) => {
      const { record } = await receivedWriteRequest()
      revoke(harness, change)

      const report = await recoverDotIntake(harness.deps)

      expect(harness.door.submits).toHaveLength(1)
      expect(report).toEqual({ submitted: 0, failed: 1, pending: 0 })
      expect(getDotIngressStore(harness.owner).get(record.dotRequestId)).toMatchObject({
        state: 'failed',
        failureCode: FAILURE_BY_REVOCATION[change],
        workbenchRequestId: null
      })
    }
  )

  it.each(REVOCATIONS)(
    'never resubmits a request refused after %s, even once dot is allowed again',
    async (change) => {
      const { record, request } = await receivedWriteRequest()
      revoke(harness, change)
      await recoverDotIntake(harness.deps)
      restore(harness)

      expect(await recoverDotIntake(harness.deps)).toEqual({ submitted: 0, failed: 0, pending: 0 })
      const replay = await submitDotRequest(harness.deps, request)

      expect(replay).toMatchObject({ duplicate: true, record: { state: 'failed' } })
      expect(harness.door.submits).toHaveLength(1)
      expect(getDotIngressStore(harness.owner).get(record.dotRequestId).state).toBe('failed')
    }
  )

  it('settles a received request refused on its replay, and answers the replay with the refusal', async () => {
    const { record, request } = await receivedWriteRequest()
    lowerCeiling(harness)

    expect(await rejectionCodeOf(() => submitDotRequest(harness.deps, request))).toBe(
      'dot_access_above_maximum'
    )

    expect(harness.door.submits).toHaveLength(1)
    expect(getDotIngressStore(harness.owner).get(record.dotRequestId)).toMatchObject({
      state: 'failed',
      failureCode: 'intake_refused'
    })
  })

  it('keeps recovering the other requests when one of them throws, and counts it as pending', async () => {
    const first = await receivedWriteRequest()
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const second = await submitDotRequest(
      harness.deps,
      harness.submitRequest({ requestedAccess: 'workspace_write', idempotencyKey: fixtureUuid(2) })
    )
    expect(second.record.state).toBe('received')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let reads = 0
    const deps = {
      ...harness.deps,
      requireWorkspace: (workspaceId: string) => {
        reads += 1
        if (reads === 1) {
          throw new Error('Fixture: catalog read failed at C:\\private')
        }
        return harness.deps.requireWorkspace(workspaceId)
      }
    }

    const report = await recoverDotIntake(deps)

    expect(report).toEqual({ submitted: 1, failed: 0, pending: 1 })
    expect(getDotIngressStore(harness.owner).get(first.record.dotRequestId).state).toBe('received')
    expect(getDotIngressStore(harness.owner).get(second.record.dotRequestId).state).toBe(
      'submitted'
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[dot-ingress]'), 'unexpected')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private')
    warn.mockRestore()
  })

  it('re-runs the requirement rules on recovery, without calling the door', async () => {
    await receivedWriteRequest()
    const [handle] = getDotIngressStore(harness.owner).listUnsubmitted(10)
    if (!handle) {
      throw new Error('expected a received request')
    }

    const finished = await finishDotIntake(harness.deps, {
      ...handle,
      objective: '設定ファイルを要約してください。'
    })

    expect(finished).toMatchObject({ state: 'failed', failureCode: 'intake_refused' })
    expect(harness.door.submits).toHaveLength(1)
  })

  it('shows a refused request as failed with no run, in the current contract', async () => {
    const { record } = await receivedWriteRequest()
    revoke(harness, 'global_off')
    await recoverDotIntake(harness.deps)
    const settled = getDotIngressStore(harness.owner).get(record.dotRequestId)

    const result = DotStatusResultSchema.parse(statusResult(harness.owner, settled))

    expect(result.request).toMatchObject({
      state: 'failed',
      run: null,
      requestedAccess: 'workspace_write'
    })
  })
})

describe('dot intake recovery: a request the Workbench already accepted is only linked', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness({ maxAccess: 'workspace_write' })
  })
  afterEach(() => harness.close())

  // The door created the Workbench request and started its run, then the answer was lost.
  async function acceptedButUnlinked() {
    const door = harness.door
    const submitThroughDoor = door.submit.bind(door)
    door.submit = (target, params) => {
      submitThroughDoor(target, params)
      throw new Error('fixture: the answer was lost')
    }
    const { record } = await submitDotRequest(
      harness.deps,
      harness.submitRequest({ requestedAccess: 'workspace_write' })
    )
    door.submit = submitThroughDoor
    expect(record.state).toBe('received')
    return record
  }

  it.each(REVOCATIONS)(
    'links it after %s without another door call, and shows its real run',
    async (change) => {
      const record = await acceptedButUnlinked()
      revoke(harness, change)

      const report = await recoverDotIntake(harness.deps)

      expect(report).toEqual({ submitted: 1, failed: 0, pending: 0 })
      expect(harness.door.submits).toHaveLength(1)
      const linked = getDotIngressStore(harness.owner).get(record.dotRequestId)
      expect(linked.state).toBe('submitted')
      expect(linked.workbenchRequestId).not.toBeNull()
      // Revoking dot stops future work only: the accepted run is reported as it is, never as canceled.
      expect(statusResult(harness.owner, linked).request).toMatchObject({
        state: 'submitted',
        run: { state: 'active', blocker: null }
      })
    }
  )
})

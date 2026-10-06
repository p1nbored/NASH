import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { cancelDotRequest } from './dot-ingress-cancel'
import { submitDotRequest } from './dot-ingress-intake'
import {
  createDotHarness,
  fixtureUuid,
  rejectionCodeOf,
  type DotHarness
} from './dot-ingress-service.test-fixture'

describe('dot cancel: the run stops before the request is canceled', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness()
  })
  afterEach(() => harness.close())

  async function submitted() {
    return (await submitDotRequest(harness.deps, harness.submitRequest())).record
  }

  it('stops the run through the door under the dot principal, then records the cancel', async () => {
    const record = await submitted()
    const door = harness.door
    const cancelThroughDoor = door.cancel.bind(door)
    let dotStateAtDoor: string | null = null
    door.cancel = (target, params) => {
      dotStateAtDoor = getDotIngressStore(harness.owner).get(record.dotRequestId).state
      return cancelThroughDoor(target, params)
    }

    const outcome = await cancelDotRequest(harness.deps, record.dotRequestId)

    expect(dotStateAtDoor).toBe('submitted')
    expect(door.cancels).toHaveLength(1)
    expect(door.cancels[0]?.target.principalId).toBe(DOT_INGRESS_PRINCIPAL_ID)
    expect(door.cancels[0]?.params).toMatchObject({
      requestId: record.workbenchRequestId,
      expectedRevision: expect.any(Number)
    })
    expect(outcome).toMatchObject({ changed: true, record: { state: 'canceled' } })
    const run = getWorkflowRunStore(harness.owner).getByRequestId(record.workbenchRequestId ?? '')
    expect(run?.status).toBe('canceled')
  })

  it('reports no change for a repeated cancel and does not call the door again', async () => {
    const record = await submitted()
    await cancelDotRequest(harness.deps, record.dotRequestId)
    const again = await cancelDotRequest(harness.deps, record.dotRequestId)
    expect(again).toMatchObject({ changed: false, record: { state: 'canceled' } })
    expect(harness.door.cancels).toHaveLength(1)
  })

  it('cancels a request the door had not launched yet', async () => {
    harness.door.launch = 'received'
    const record = await submitted()
    const outcome = await cancelDotRequest(harness.deps, record.dotRequestId)
    expect(outcome.record.state).toBe('canceled')
  })

  it('records the cancel without the door when the Workbench request is already canceled', async () => {
    harness.door.launch = 'received'
    const record = await submitted()
    harness.owner.db
      .prepare("UPDATE workbench_requests SET status = 'CANCELED' WHERE request_id = ?")
      .run(record.workbenchRequestId)
    const outcome = await cancelDotRequest(harness.deps, record.dotRequestId)
    expect(outcome.record.state).toBe('canceled')
    expect(harness.door.cancels).toHaveLength(0)
  })

  it('refuses a request whose intake has not finished or that failed, without the door', async () => {
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const received = await submitted()
    harness.door.failNextSubmit = new OrchestrationError('workbench_capacity_exceeded', 'fixture')
    const failed = (
      await submitDotRequest(
        harness.deps,
        harness.submitRequest({ idempotencyKey: fixtureUuid(2) })
      )
    ).record
    for (const record of [received, failed]) {
      expect(await rejectionCodeOf(() => cancelDotRequest(harness.deps, record.dotRequestId))).toBe(
        'dot_request_not_cancelable'
      )
    }
    expect(harness.door.cancels).toHaveLength(0)
  })

  it('reports a request the door will not cancel as not cancelable and keeps it submitted', async () => {
    const record = await submitted()
    harness.door.failCancel = new OrchestrationError('workbench_request_handed_off', 'fixture')
    expect(await rejectionCodeOf(() => cancelDotRequest(harness.deps, record.dotRequestId))).toBe(
      'dot_request_not_cancelable'
    )
    expect(getDotIngressStore(harness.owner).get(record.dotRequestId).state).toBe('submitted')
  })

  // The door is async: it waits for the launch, stops the primary, then cancels the run and request.
  it.each([
    ['workbench_run_stop_unconfirmed', 'dot_request_busy', { reason: 'run_stop_unconfirmed' }],
    ['workbench_run_stop_refused', 'dot_request_busy', { reason: 'run_stop_refused' }],
    [
      'autopilot_primary_session_not_configured',
      'dot_request_busy',
      { reason: 'run_control_unavailable' }
    ],
    ['workbench_revision_conflict', 'dot_request_busy', { reason: 'request_changed' }],
    ['workbench_run_completed', 'dot_request_not_cancelable', { reason: 'run_completed' }],
    ['workbench_run_not_found', 'dot_recovery_required', undefined],
    ['workbench_request_not_found', 'dot_recovery_required', undefined],
    ['workbench_workspace_unavailable', 'dot_workspace_unavailable', undefined]
  ])(
    'maps the door refusal %s to %s and keeps the request submitted',
    async (doorCode, code, data) => {
      const record = await submitted()
      const failure = new OrchestrationError(doorCode, 'fixture internal detail', {
        stopCode: 'autopilot_fixture_stop_code'
      })
      harness.door.cancel = async () => {
        throw failure
      }
      let refusal: unknown = null
      try {
        await cancelDotRequest(harness.deps, record.dotRequestId)
      } catch (error) {
        refusal = error
      }
      expect(refusal).toBeInstanceOf(OrchestrationError)
      expect(refusal).toMatchObject({ code })
      // Coarse: the door's message and stop code never reach the dot.
      expect(refusal).not.toMatchObject({ message: 'fixture internal detail' })
      expect(refusal instanceof OrchestrationError ? refusal.data : null).toEqual(data)
      expect(getDotIngressStore(harness.owner).get(record.dotRequestId).state).toBe('submitted')
    }
  )

  it('retries once when the request moved on between its read and the cancel', async () => {
    const record = await submitted()
    const door = harness.door
    const cancelThroughDoor = door.cancel.bind(door)
    let conflicts = 1
    door.cancel = (target, params) => {
      if (conflicts > 0) {
        conflicts -= 1
        throw new OrchestrationError('workbench_revision_conflict', 'fixture')
      }
      return cancelThroughDoor(target, params)
    }
    const outcome = await cancelDotRequest(harness.deps, record.dotRequestId)
    expect(outcome).toMatchObject({ changed: true, record: { state: 'canceled' } })
    expect(door.cancels).toHaveLength(1)
  })

  it('keeps the request submitted when stopping fails for another reason', async () => {
    const record = await submitted()
    harness.door.failCancel = new Error('stop unconfirmed')
    await expect(cancelDotRequest(harness.deps, record.dotRequestId)).rejects.toThrow(
      'stop unconfirmed'
    )
    expect(getDotIngressStore(harness.owner).get(record.dotRequestId).state).toBe('submitted')
  })

  it('refuses before the door when the run cannot be proven to come from this request', async () => {
    const record = await submitted()
    harness.owner.db
      .prepare(
        "UPDATE workbench_requests SET principal_id = 'local-desktop-ui' WHERE request_id = ?"
      )
      .run(record.workbenchRequestId)
    expect(await rejectionCodeOf(() => cancelDotRequest(harness.deps, record.dotRequestId))).toBe(
      'dot_recovery_required'
    )
    expect(harness.door.cancels).toHaveLength(0)
  })

  it('refuses when the workspace can no longer be admitted', async () => {
    const record = await submitted()
    harness.setWorkspace(null)
    expect(await rejectionCodeOf(() => cancelDotRequest(harness.deps, record.dotRequestId))).toBe(
      'dot_workspace_unavailable'
    )
    expect(harness.door.cancels).toHaveLength(0)
  })

  it('refuses an unknown request and every cancel while the interface is off', async () => {
    const record = await submitted()
    expect(await rejectionCodeOf(() => cancelDotRequest(harness.deps, fixtureUuid(99)))).toBe(
      'dot_request_not_found'
    )
    getDotIngressSettingsStore(harness.owner).setEnabled({
      enabled: false,
      timestamp: '2026-10-05T00:02:00.000Z'
    })
    expect(await rejectionCodeOf(() => cancelDotRequest(harness.deps, record.dotRequestId))).toBe(
      'dot_ingress_disabled'
    )
  })
})

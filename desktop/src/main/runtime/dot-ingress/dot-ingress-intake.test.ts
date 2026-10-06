import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOT_INGRESS_PRINCIPAL_ID } from '../../../shared/dot-ingress/dot-ingress-limits'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { finishDotIntake, recoverDotIntake, submitDotRequest } from './dot-ingress-intake'
import {
  FIXTURE_OBJECTIVE,
  FIXTURE_WORKSPACE,
  createDotHarness,
  fixtureUuid,
  rejectionCodeOf,
  type DotHarness
} from './dot-ingress-service.test-fixture'

function workbenchRowCount(harness: DotHarness): number {
  return Number(harness.owner.db.prepare('SELECT count(*) AS n FROM workbench_requests').get()?.n)
}

function dotRowCount(harness: DotHarness): number {
  return Number(harness.owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_requests').get()?.n)
}

describe('dot intake: submission through the single door (D-018)', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness()
  })
  afterEach(() => harness.close())

  it('files a valid request under the dot principal and starts it through the door once', async () => {
    const outcome = await submitDotRequest(harness.deps, harness.submitRequest())

    expect(harness.door.submits).toHaveLength(1)
    const call = harness.door.submits[0]
    expect(call?.target.principalId).toBe(DOT_INGRESS_PRINCIPAL_ID)
    expect(call?.target.workspace).toBe(FIXTURE_WORKSPACE)
    expect(call?.params).toEqual({
      workspaceId: FIXTURE_WORKSPACE.workspaceId,
      objective: FIXTURE_OBJECTIVE,
      idempotencyKey: expect.any(String),
      requestedAccess: 'read_only'
    })
    // The door gets the stored Workbench key, never the dot's own key.
    expect(call?.params.idempotencyKey).not.toBe(fixtureUuid(1))
    expect(outcome.duplicate).toBe(false)
    expect(outcome.record).toMatchObject({ state: 'submitted', requestedAccess: 'read_only' })
    const linked = harness.owner.db
      .prepare('SELECT principal_id FROM workbench_requests WHERE request_id = ?')
      .get(outcome.record.workbenchRequestId)
    expect(linked).toEqual({ principal_id: DOT_INGRESS_PRINCIPAL_ID })
  })

  it('passes the canonical language and an access the workspace allows to the door', async () => {
    harness.close()
    harness = createDotHarness({ maxAccess: 'workspace_write' })
    const outcome = await submitDotRequest(
      harness.deps,
      harness.submitRequest({
        requestedAccess: 'workspace_write',
        deliverableLanguage: 'zh-hant-tw'
      })
    )

    expect(harness.door.submits[0]?.params).toMatchObject({
      requestedAccess: 'workspace_write',
      deliverableLanguage: 'zh-Hant-TW'
    })
    const run = getWorkflowRunStore(harness.owner).getByRequestId(
      outcome.record.workbenchRequestId ?? ''
    )
    expect(run?.requestedAccess).toBe('workspace_write')
  })

  it('returns the first receipt for a replay and never calls the door again', async () => {
    const first = await submitDotRequest(harness.deps, harness.submitRequest())
    const replay = await submitDotRequest(harness.deps, harness.submitRequest())

    expect(replay.duplicate).toBe(true)
    expect(replay.record.dotRequestId).toBe(first.record.dotRequestId)
    expect(harness.door.submits).toHaveLength(1)
    expect(workbenchRowCount(harness)).toBe(1)
  })

  it('keeps an interrupted intake received and finishes it on the retry, with one Workbench request', async () => {
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const interrupted = await submitDotRequest(harness.deps, harness.submitRequest())
    expect(interrupted.record.state).toBe('received')
    expect(workbenchRowCount(harness)).toBe(0)

    const retried = await submitDotRequest(harness.deps, harness.submitRequest())
    expect(retried).toMatchObject({ duplicate: true, record: { state: 'submitted' } })
    expect(retried.record.dotRequestId).toBe(interrupted.record.dotRequestId)
    expect(harness.door.submits).toHaveLength(2)
    expect(harness.door.submits[0]?.params.idempotencyKey).toBe(
      harness.door.submits[1]?.params.idempotencyKey
    )
    expect(workbenchRowCount(harness)).toBe(1)
  })

  it.each([
    ['workbench_capacity_exceeded', 'capacity_exceeded'],
    ['workbench_workspace_unavailable', 'workspace_unavailable'],
    ['unsupported_host', 'workspace_unavailable'],
    ['workbench_idempotency_conflict', 'intake_refused'],
    ['workbench_invalid_input', 'intake_refused'],
    ['workbench_forbidden', 'intake_refused']
  ])(
    'marks the request failed when the door refuses with %s before creating anything',
    async (code, failure) => {
      harness.door.failNextSubmit = new OrchestrationError(code, 'fixture')
      const outcome = await submitDotRequest(harness.deps, harness.submitRequest())
      expect(outcome.record).toMatchObject({ state: 'failed', failureCode: failure })
    }
  )

  it('refuses everything while the interface is off, and stores nothing', async () => {
    harness.close()
    harness = createDotHarness({ enabled: false })
    expect(
      await rejectionCodeOf(() => submitDotRequest(harness.deps, harness.submitRequest()))
    ).toBe('dot_ingress_disabled')
    expect(harness.door.submits).toHaveLength(0)
    expect(dotRowCount(harness)).toBe(0)
  })

  it('refuses a workspace reference the user did not enable', async () => {
    const request = harness.submitRequest({ workspaceRef: `dws_${'0'.repeat(24)}` })
    expect(await rejectionCodeOf(() => submitDotRequest(harness.deps, request))).toBe(
      'dot_workspace_unknown'
    )
    expect(dotRowCount(harness)).toBe(0)
  })

  it('refuses an access above the workspace ceiling and names only the ceiling', async () => {
    const request = harness.submitRequest({ requestedAccess: 'workspace_write' })
    let refusal: unknown = null
    try {
      await submitDotRequest(harness.deps, request)
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(OrchestrationError)
    expect(refusal).toMatchObject({
      code: 'dot_access_above_maximum',
      data: { reason: 'access_above_workspace_maximum', maxAccess: 'read_only' }
    })
    expect(dotRowCount(harness)).toBe(0)
    expect(harness.door.submits).toHaveLength(0)
  })

  it('refuses a workspace the app can no longer admit', async () => {
    harness.setWorkspace(null)
    expect(
      await rejectionCodeOf(() => submitDotRequest(harness.deps, harness.submitRequest()))
    ).toBe('dot_workspace_unavailable')
    expect(dotRowCount(harness)).toBe(0)
  })

  it('rejects a requirement before anything is stored or handed on', async () => {
    const request = harness.submitRequest({ objective: '設定ファイルを要約してください。' })
    expect(await rejectionCodeOf(() => submitDotRequest(harness.deps, request))).toBe(
      'dot_requirement_not_english'
    )
    expect(dotRowCount(harness)).toBe(0)
    expect(harness.door.submits).toHaveLength(0)
  })

  it('awaits a door that launches the run before it answers', async () => {
    const synchronous = harness.door.submit.bind(harness.door)
    harness.door.submit = async (target, params) => {
      await Promise.resolve()
      return synchronous(target, params)
    }
    const outcome = await submitDotRequest(harness.deps, harness.submitRequest())
    expect(outcome.record.state).toBe('submitted')
  })
})

describe('dot intake: recovery after a restart', () => {
  let harness: DotHarness
  beforeEach(() => {
    harness = createDotHarness()
  })
  afterEach(() => harness.close())

  it('finishes every received request once, with the same Workbench key', async () => {
    for (const n of [1, 2]) {
      harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
      await submitDotRequest(
        harness.deps,
        harness.submitRequest({ idempotencyKey: fixtureUuid(n) })
      )
    }
    const report = await recoverDotIntake(harness.deps)

    expect(report).toEqual({ submitted: 2, failed: 0, pending: 0 })
    expect(workbenchRowCount(harness)).toBe(2)
    expect(getDotIngressStore(harness.owner).listUnsubmitted(10)).toEqual([])
    expect(await recoverDotIntake(harness.deps)).toEqual({ submitted: 0, failed: 0, pending: 0 })
  })

  it('fails a request whose workspace changed since it was recorded, without calling the door', async () => {
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    const { record } = await submitDotRequest(harness.deps, harness.submitRequest())
    harness.setWorkspace({ ...FIXTURE_WORKSPACE, path: '/fixture/moved' })
    const [handle] = getDotIngressStore(harness.owner).listUnsubmitted(10)
    if (!handle) {
      throw new Error('expected a received request')
    }
    const finished = await finishDotIntake(harness.deps, handle)

    expect(finished).toMatchObject({
      dotRequestId: record.dotRequestId,
      state: 'failed',
      failureCode: 'workspace_unavailable'
    })
    expect(harness.door.submits).toHaveLength(1)
  })

  it('leaves a request received when the door fails in a way that may have created it', async () => {
    harness.door.failNextSubmit = new OrchestrationError('workbench_recovery_required', 'fixture')
    await submitDotRequest(harness.deps, harness.submitRequest())
    harness.door.failNextSubmit = new Error('socket closed')
    expect(await recoverDotIntake(harness.deps)).toEqual({ submitted: 0, failed: 0, pending: 1 })
    expect(getDotIngressStore(harness.owner).listUnsubmitted(10)).toHaveLength(1)
  })
})

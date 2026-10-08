import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDotHarness,
  FIXTURE_BINDING,
  fixtureUuid,
  type DotHarness
} from './dot-ingress-service.test-fixture'
import { seedRunWithRunningOwner } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { attachDotCoordinator } from './dot-ingress-attach'
import { findDotRequestOfRun, findDotRequestRun } from './dot-ingress-run-link'
import { projectDotRun } from './dot-ingress-run-projection'
import { recoverDotIntake } from './dot-ingress-intake'
import {
  readWorkflowRunController,
  readWorkflowRunOrigin
} from '../workflow-run/workflow-run-origin'
import { cancelDotRequest } from './dot-ingress-cancel'
import { getRunMessageStore } from '../orchestration/db/run-message-store'

describe('Dot takeover of an existing native coordinator', () => {
  let h: DotHarness
  beforeEach(() => {
    h = createDotHarness()
    seedRunWithRunningOwner(h.owner)
    h.owner.db
      .prepare("UPDATE workflow_runs SET workspace_binding = ?, status = 'active'")
      .run(FIXTURE_BINDING)
  })
  afterEach(() => h.close())
  const input = () => ({
    ...h.submitRequest(),
    contractVersion: 3 as const,
    coordinatorRunId: 'run_fixture01'
  })
  const adopt = () => ({ run: getWorkflowRunStore(h.owner).get('run_fixture01')! })

  it('keeps the run and task records, creates no new CLI, and links status and decisions', async () => {
    const task = h.owner.createTask({ runId: 'run_fixture01', spec: 'Existing work' })
    const before = readWorkflowRunOrigin(h.owner, 'run_fixture01')
    const result = await attachDotCoordinator(h.deps, input(), adopt)
    expect(result.record.state).toBe('submitted')
    expect(h.door.submits).toEqual([])
    expect(getRunMessageStore(h.owner).listHeld('run_fixture01', 10)).toMatchObject([
      {
        source: 'dot',
        sourceRequestId: input().idempotencyKey,
        text: input().objective,
        state: 'held'
      }
    ])
    expect(h.owner.getTask(task.id)).toEqual(task)
    expect(findDotRequestRun(h.owner, result.record)?.runId).toBe('run_fixture01')
    expect(findDotRequestOfRun(h.owner, 'run_fixture01')?.dotRequestId).toBe(
      result.record.dotRequestId
    )
    expect(projectDotRun(h.owner, result.record)).toEqual({ state: 'active', blocker: null })
    expect(readWorkflowRunController(h.owner, 'run_fixture01')).toMatchObject({ origin: 'dot' })
    expect(readWorkflowRunOrigin(h.owner, 'run_fixture01')).toEqual(before)
    await recoverDotIntake(h.deps)
    expect(h.door.submits).toEqual([])
  })
  it('replays an attachment without creating another request or launching a run', async () => {
    const first = await attachDotCoordinator(h.deps, input(), adopt)
    const second = await attachDotCoordinator(h.deps, input(), adopt)
    expect(second).toMatchObject({
      duplicate: true,
      record: { dotRequestId: first.record.dotRequestId }
    })
    expect(getDotIngressStore(h.owner).listUnsubmitted(10)).toEqual([])
    await expect(
      attachDotCoordinator(h.deps, { ...input(), objective: 'Different objective' }, adopt)
    ).rejects.toMatchObject({ code: 'dot_idempotency_conflict' })
  })
  it('replays the receipt after coordinator exit and rejects key reuse before adoption', async () => {
    const first = await attachDotCoordinator(h.deps, input(), adopt)
    const unavailable = vi.fn(() => {
      throw new Error('coordinator exited')
    })
    const replay = await attachDotCoordinator(h.deps, input(), unavailable)
    expect(replay.record.dotRequestId).toBe(first.record.dotRequestId)
    expect(unavailable).not.toHaveBeenCalled()
    await expect(
      attachDotCoordinator(h.deps, { ...input(), coordinatorRunId: 'run_other' }, unavailable)
    ).rejects.toMatchObject({ code: 'dot_idempotency_conflict' })
    expect(unavailable).not.toHaveBeenCalled()
  })
  it('does not call adoption when the workspace is disabled', async () => {
    getDotIngressSettingsStore(h.owner).disableWorkspace({
      workspaceRef: h.workspaceRef,
      timestamp: h.deps.now().toISOString()
    })
    const callback = vi.fn(adopt)
    await expect(attachDotCoordinator(h.deps, input(), callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })
  it('revokes Dot control when the attached workspace is disabled', async () => {
    const result = await attachDotCoordinator(h.deps, input(), adopt)
    getDotIngressSettingsStore(h.owner).disableWorkspace({
      workspaceRef: h.workspaceRef,
      timestamp: h.deps.now().toISOString()
    })
    expect(findDotRequestOfRun(h.owner, 'run_fixture01')).toBeNull()
    expect(readWorkflowRunController(h.owner, 'run_fixture01')).not.toMatchObject({ origin: 'dot' })
    expect(() => findDotRequestRun(h.owner, result.record)).toThrow()
  })
  it('refuses a different workspace or access without linking the run', async () => {
    await expect(
      attachDotCoordinator(h.deps, input(), () => ({
        run: { ...adopt().run, workspaceId: 'other' }
      }))
    ).rejects.toMatchObject({ code: 'dot_workspace_unavailable' })
    await expect(
      attachDotCoordinator(h.deps, input(), () => ({
        run: { ...adopt().run, requestedAccess: 'workspace_write' }
      }))
    ).rejects.toMatchObject({ code: 'dot_access_above_maximum' })
    expect(getDotIngressStore(h.owner).list({ limit: 10 }).records).toEqual([])
  })
  it('rolls back a failed attachment so recovery cannot launch a duplicate coordinator', async () => {
    const first = await attachDotCoordinator(h.deps, input(), adopt)
    await expect(
      attachDotCoordinator(h.deps, { ...input(), idempotencyKey: fixtureUuid(2) }, adopt)
    ).rejects.toThrow()
    expect(
      getDotIngressStore(h.owner)
        .list({ limit: 10 })
        .records.map((r) => r.dotRequestId)
    ).toEqual([first.record.dotRequestId])
    expect(getDotIngressStore(h.owner).listUnsubmitted(10)).toEqual([])
  })
  it('does not stop a user-owned CLI through request cancellation', async () => {
    const result = await attachDotCoordinator(h.deps, input(), adopt)
    await expect(cancelDotRequest(h.deps, result.record.dotRequestId)).rejects.toMatchObject({
      code: 'dot_request_not_cancelable'
    })
    expect(h.door.cancels).toEqual([])
  })
})

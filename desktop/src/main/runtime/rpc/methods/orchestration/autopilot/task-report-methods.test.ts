import { afterEach, describe, expect, it } from 'vitest'
import { TaskReportParams } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import { TaskReportResultSchema } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { seedRoutedTask } from '../../../../orchestration/db/app-attempt-routing.test-fixture'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './autopilot-task-api'
import {
  createTaskApiHarness,
  seedInSessionAttempt,
  type TaskApiHarness
} from './autopilot-task-api.test-fixture'
import { TASK_REPORT_METHOD } from './task-report-methods'

const SUMMARY = 'Wrote `report.md`; it names every top-level folder.'

type Report = {
  taskId: string
  attemptId: string
  outcome?: 'succeeded' | 'failed'
  summary?: string
}

describe('orchestration.taskReport', () => {
  let harness: TaskApiHarness | undefined

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  function report(input: Report) {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    const params = TaskReportParams.parse({ outcome: 'succeeded', summary: SUMMARY, ...input })
    return Promise.resolve().then(() => TASK_REPORT_METHOD.handler(params, current.context))
  }

  function runMail() {
    return harness?.db.getAllMessagesForHandle(`run:${harness.runId}`, 50) ?? []
  }

  it('is the strict-params method orchestration.taskReport', () => {
    expect(TASK_REPORT_METHOD.name).toBe('orchestration.taskReport')
    expect(TASK_REPORT_METHOD.params).toBe(TaskReportParams)
  })

  it('settles an in-session claim for validation and never completes the task', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    const result = TaskReportResultSchema.parse(await report({ taskId, attemptId: dispatchId }))
    expect(result).toMatchObject({ attemptId: dispatchId, outcome: 'claimed' })
    expect(result.task).toMatchObject({ status: 'blocked', phase: 'validating', waitable: true })
    expect(harness.db.getTask(taskId)?.status).toBe('blocked')
    expect(harness.db.getWorkerDispatch(dispatchId)?.stage).toBe('validation_pending')
    expect(harness.ports.afterClaim).toHaveBeenCalledWith({
      runId: harness.runId,
      taskId,
      dispatchId
    })
  })

  it('keeps the report in the run mailbox and announces it', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    await report({ taskId, attemptId: dispatchId })
    const notice = runMail().find((message) => message.from_handle === `dispatch:${dispatchId}`)
    expect(notice).toMatchObject({
      type: 'status',
      body: SUMMARY,
      subject: `Task ${taskId}: attempt reported finished, validation pending`
    })
    expect(harness.notify).toHaveBeenCalledWith(`run:${harness.runId}`, 'status')
  })

  it('fails the attempt and the task on a failed report', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    const result = TaskReportResultSchema.parse(
      await report({
        taskId,
        attemptId: dispatchId,
        outcome: 'failed',
        summary: 'The build failed.'
      })
    )
    expect(result.outcome).toBe('failed')
    expect(result.task.phase).toBe('failed')
    expect(harness.db.getTask(taskId)?.status).toBe('failed')
    expect(harness.ports.afterClaim).not.toHaveBeenCalled()
  })

  it('refuses an attempt that is not the current one of the task', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedInSessionAttempt(harness)
    await expect(report({ taskId, attemptId: 'ctx_other' })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.attemptMismatch,
      data: { effectsApplied: false }
    })
    expect(harness.db.getTask(taskId)?.status).toBe('dispatched')
  })

  it('refuses a report for an attempt running as a native worker', async () => {
    harness = createTaskApiHarness()
    const { taskId, routeId } = seedRoutedTask({ owner: harness.db, runId: harness.runId })
    const { dispatch } = harness.db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 3,
      taskId,
      startOptions: { nativeTask: true, route_id: routeId }
    })
    const dispatchId = dispatch.id
    await expect(report({ taskId, attemptId: dispatchId })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.reportNotInSession
    })
  })

  it.each([
    ['not_english', 'Отчёт готов.'],
    ['secret_shaped', 'Used sk-0123456789abcdef0123456789abcdef to sign in.'],
    ['control_characters', 'Done.\u001b[2J']
  ])('refuses a %s summary and settles nothing', async (reason, summary) => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    await expect(report({ taskId, attemptId: dispatchId, summary })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.summaryRefused,
      data: { reason, effectsApplied: false }
    })
    expect(harness.db.getTask(taskId)?.status).toBe('dispatched')
  })

  it('refuses a second report of the same attempt', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    await report({ taskId, attemptId: dispatchId })
    await expect(report({ taskId, attemptId: dispatchId })).rejects.toMatchObject({
      code: expect.stringMatching(/^autopilot_/)
    })
    expect(harness.ports.afterClaim).toHaveBeenCalledTimes(1)
  })

  it('keeps a durable claim when the validation hook throws', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    harness.ports.afterClaim.mockImplementationOnce(() => {
      throw Object.assign(new Error('x'), { code: 'autopilot_validation_unavailable' })
    })
    const result = TaskReportResultSchema.parse(await report({ taskId, attemptId: dispatchId }))
    expect(result.outcome).toBe('claimed')
    expect(harness.ports.log).toHaveBeenCalledWith({
      event: 'after_claim_failed',
      taskId,
      dispatchId,
      code: 'autopilot_validation_unavailable'
    })
  })

  it('refuses outside an active run and for any other caller', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    harness.setAuthority(null)
    await expect(report({ taskId, attemptId: dispatchId })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.callerRefused
    })
    expect(harness.db.getTask(taskId)?.status).toBe('dispatched')
  })
})

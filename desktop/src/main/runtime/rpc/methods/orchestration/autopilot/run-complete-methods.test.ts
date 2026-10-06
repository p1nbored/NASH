import { afterEach, describe, expect, it } from 'vitest'
import { RunCompleteParams } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import { RunCompleteResultSchema } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { seedTask } from '../../../../orchestration/db/app-attempt.test-fixture'
import { getWorkflowRunStore } from '../../../../orchestration/db/workflow-run-store'
import { addValidationRow } from '../../../../workflow-run/app-run-policy.test-fixture'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './autopilot-task-api'
import {
  PRIMARY_HANDLE,
  createTaskApiHarness,
  seedInSessionAttempt,
  type TaskApiHarness
} from './autopilot-task-api.test-fixture'
import { RUN_COMPLETE_METHOD } from './run-complete-methods'

const SUMMARY = 'Both reports are written and validated.'
const UNSETTLED = AUTOPILOT_TASK_API_ERROR_CODES.tasksUnsettled

describe('orchestration.runComplete', () => {
  let harness: TaskApiHarness | undefined

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  function complete(summary = SUMMARY) {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    return Promise.resolve().then(() =>
      RUN_COMPLETE_METHOD.handler(RunCompleteParams.parse({ summary }), current.context)
    )
  }

  function runStatus(): string | undefined {
    return harness ? getWorkflowRunStore(harness.db).get(harness.runId)?.status : undefined
  }

  function settledTask(status: 'completed' | 'failed', validation?: 'pass' | 'waived'): string {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    const { taskId } = seedTask({ owner: current.db, runId: current.runId })
    current.db.updateTaskStatus(taskId, status)
    if (validation === 'pass') {
      addValidationRow(current.db, taskId, 'pass')
    } else if (validation === 'waived') {
      addValidationRow(current.db, taskId, 'inconclusive', 'dot')
    }
    return taskId
  }

  it('is the strict-params method orchestration.runComplete', () => {
    expect(RUN_COMPLETE_METHOD.name).toBe('orchestration.runComplete')
    expect(RUN_COMPLETE_METHOD.params).toBe(RunCompleteParams)
  })

  it('completes a run whose tasks are validated, waived or failed, and keeps the summary', async () => {
    harness = createTaskApiHarness()
    settledTask('completed', 'pass')
    settledTask('completed', 'waived')
    settledTask('failed')
    const result = RunCompleteResultSchema.parse(await complete())
    expect(result).toMatchObject({
      runId: harness.runId,
      status: 'completed',
      completedTasks: 2,
      failedTasks: 1
    })
    expect(runStatus()).toBe('completed')
    const summary = harness.db
      .getAllMessagesForHandle(`run:${harness.runId}`, 50)
      .find((message) => message.id === result.summaryMessageId)
    expect(summary).toMatchObject({ from_handle: PRIMARY_HANDLE, body: SUMMARY, type: 'status' })
    expect(harness.notify).not.toHaveBeenCalled()
    expect(harness.ports.afterRunCompleted).toHaveBeenCalledWith(harness.runId)
  })

  it('completes a run that never proposed a task', async () => {
    harness = createTaskApiHarness()
    await expect(complete()).resolves.toMatchObject({ completedTasks: 0, failedTasks: 0 })
    expect(runStatus()).toBe('completed')
  })

  it('refuses while any task is unsettled and leaves the run active', async () => {
    harness = createTaskApiHarness()
    settledTask('completed', 'pass')
    const ready = seedTask({ owner: harness.db, runId: harness.runId }).taskId
    const { taskId: running } = seedInSessionAttempt(harness)
    await expect(complete()).rejects.toMatchObject({
      code: UNSETTLED,
      message: expect.stringMatching(/^The run cannot complete: 2 tasks are not settled/),
      data: {
        effectsApplied: false,
        unsettledTasks: expect.arrayContaining([
          { taskId: ready, status: 'ready' },
          { taskId: running, status: 'dispatched' }
        ])
      }
    })
    expect(runStatus()).toBe('active')
    expect(harness.ports.afterRunCompleted).not.toHaveBeenCalled()
  })

  it('treats a completed task without a passing or waived validation as unsettled', async () => {
    harness = createTaskApiHarness()
    const taskId = settledTask('completed')
    await expect(complete()).rejects.toMatchObject({
      code: UNSETTLED,
      data: { unsettledTasks: [{ taskId, status: 'completed_unvalidated' }] }
    })
    expect(runStatus()).toBe('active')
  })

  it('refuses a summary that is not English or holds a secret shape', async () => {
    harness = createTaskApiHarness()
    await expect(complete('Готово.')).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.summaryRefused,
      data: { reason: 'not_english' }
    })
    expect(runStatus()).toBe('active')
  })

  it('refuses outside an active run and for any other caller', async () => {
    harness = createTaskApiHarness({ runStatus: 'completing' })
    await expect(complete()).rejects.toMatchObject({ code: 'autopilot_run_not_live' })
    harness.close()
    harness = createTaskApiHarness()
    harness.setAuthority(null)
    await expect(complete()).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.callerRefused
    })
    expect(runStatus()).toBe('active')
  })

  it('logs a failing completion hook and still reports the completed run', async () => {
    harness = createTaskApiHarness()
    harness.ports.afterRunCompleted.mockImplementationOnce(() => {
      throw Object.assign(new Error('x'), { code: 'autopilot_stop_failed' })
    })
    await expect(complete()).resolves.toMatchObject({ status: 'completed' })
    expect(harness.ports.log).toHaveBeenCalledWith({
      event: 'after_run_completed_failed',
      runId: harness.runId,
      code: 'autopilot_stop_failed'
    })
  })
})

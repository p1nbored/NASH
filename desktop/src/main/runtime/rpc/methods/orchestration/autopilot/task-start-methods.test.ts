import { afterEach, describe, expect, it } from 'vitest'
import { TaskStartParams } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import { TaskStartResultSchema } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { seedTask } from '../../../../orchestration/db/app-attempt.test-fixture'
import type { RpcContext } from '../../../core'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './autopilot-task-api'
import {
  PRIMARY_HANDLE,
  PRIMARY_PANE,
  createTaskApiHarness,
  moveRun,
  type TaskApiHarness
} from './autopilot-task-api.test-fixture'
import { TASK_START_METHOD } from './task-start-methods'

const RECEIPT = {
  callerFingerprint: 'caller_fixture',
  requestId: 'request_fixture',
  method: 'orchestration.taskStart',
  payloadHash: 'hash_fixture'
}

describe('orchestration.taskStart', () => {
  let harness: TaskApiHarness | undefined

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  function start(taskId: string, context?: RpcContext) {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    return Promise.resolve().then(() =>
      TASK_START_METHOD.handler(TaskStartParams.parse({ taskId }), context ?? current.context)
    )
  }

  it('is the strict-params method orchestration.taskStart', () => {
    expect(TASK_START_METHOD.name).toBe('orchestration.taskStart')
    expect(TASK_START_METHOD.params).toBe(TaskStartParams)
  })

  it('starts through the execution service with the attested creator and the receipt', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    const result = await start(taskId, { ...harness.context, orchestrationMutation: RECEIPT })
    expect(harness.ports.startTask).toHaveBeenCalledWith({
      taskId,
      creator: { kind: 'terminal', handle: PRIMARY_HANDLE, paneKey: PRIMARY_PANE },
      maxDepth: 3,
      runtimeEpoch: 'runtime_fixture',
      mutationReceipt: RECEIPT
    })
    expect(TaskStartResultSchema.parse(result)).toEqual({
      attempt: expect.objectContaining({ taskId, dispatchId: 'ctx_fixture', runsIn: 'process' })
    })
    expect(Object.keys(result)).toEqual(['attempt'])
  })

  it('never names a retry: the execution service derives it from Orca', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    await start(taskId)
    expect(harness.ports.startTask.mock.calls[0]?.[0]).not.toHaveProperty('retryOf')
  })

  it('refuses a task that belongs to another run before anything starts', async () => {
    harness = createTaskApiHarness()
    const foreign = harness.db.createRun({
      objective: 'Other run.',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const other = harness.db.createTask({ spec: 'Other task.', runId: foreign.id })
    await expect(start(other.id)).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.taskNotInRun,
      data: { effectsApplied: false }
    })
    await expect(start('task_missing')).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.taskNotInRun
    })
    expect(harness.ports.startTask).not.toHaveBeenCalled()
  })

  it('refuses outside an active run and for any other caller', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    moveRun(harness, 'completing')
    await expect(start(taskId)).rejects.toMatchObject({ code: 'autopilot_run_not_live' })
    harness.setAuthority(null)
    await expect(start(taskId)).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.callerRefused
    })
    expect(harness.ports.startTask).not.toHaveBeenCalled()
  })

  it('passes a refusal of the execution service through unchanged', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    const refusal = Object.assign(new Error('The route is unavailable.'), {
      code: 'autopilot_route_not_available'
    })
    harness.ports.startTask.mockRejectedValueOnce(refusal)
    await expect(start(taskId)).rejects.toBe(refusal)
  })

  it('logs a process attempt whose settlement rejects instead of leaving it unhandled', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    harness.ports.startTask.mockImplementationOnce(async (input) => ({
      view: {
        taskId: input.taskId,
        dispatchId: 'ctx_2',
        routeId: 'route_2',
        target: 'codex_cli',
        delegated: true,
        runsIn: 'process',
        taskStatus: 'dispatched',
        workerState: 'ready',
        instruction: 'Attempt `ctx_2` runs as an app process.'
      },
      settled: Promise.reject(Object.assign(new Error('x'), { code: 'autopilot_x' }))
    }))
    await start(taskId)
    await new Promise((resolve) => setImmediate(resolve))
    expect(harness.ports.log).toHaveBeenCalledWith({
      event: 'attempt_settle_rejected',
      taskId,
      dispatchId: 'ctx_2',
      code: 'autopilot_x'
    })
  })
})

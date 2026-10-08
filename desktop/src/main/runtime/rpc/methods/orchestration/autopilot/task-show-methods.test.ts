import { afterEach, describe, expect, it } from 'vitest'
import { TaskShowParams } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import { TaskShowResultSchema } from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { seedTask } from '../../../../orchestration/db/app-attempt.test-fixture'
import {
  routeInput,
  seedRoutedTask
} from '../../../../orchestration/db/app-attempt-routing.test-fixture'
import { fixtureTime } from '../../../../orchestration/db/autopilot-runtime.test-fixture'
import { getTaskClassificationStore } from '../../../../orchestration/db/task-classification-store'
import { getTaskRouteStore } from '../../../../orchestration/db/task-route-store'
import type { RpcContext } from '../../../core'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './autopilot-task-api'
import {
  createTaskApiHarness,
  moveRun,
  seedInSessionAttempt,
  type TaskApiHarness
} from './autopilot-task-api.test-fixture'
import { TASK_SHOW_METHOD } from './task-show-methods'

const OK_RESULT = {
  state: 'ok' as const,
  text: 'Masked report',
  truncated: false,
  secretLike: false,
  bytes: 13,
  sha256: '0'.repeat(64)
}

function classify(harness: TaskApiHarness, taskId: string): void {
  const classification = getTaskClassificationStore(harness.db).record({
    taskId,
    attempt: 1,
    outcome: 'classified',
    detail: null,
    needsDelegation: true,
    taskType: 'software_engineering',
    answers: null,
    bundleSha256: 'd'.repeat(64),
    taxonomyVersion: 2,
    profileSha256: 'e'.repeat(64),
    classifierModel: 'fixture-classifier',
    rawResponseId: null,
    spendReservationId: null,
    timestamp: fixtureTime(2)
  })
  getTaskRouteStore(harness.db).record(
    routeInput(classification.classificationId, { target: 'claude_subagent', model: 'x' })
  )
}

describe('orchestration.taskShow', () => {
  let harness: TaskApiHarness | undefined

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  async function show(params: { taskId: string; waitMs?: number }, context?: RpcContext) {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    const raw = await TASK_SHOW_METHOD.handler(
      TaskShowParams.parse(params),
      context ?? current.context
    )
    return TaskShowResultSchema.parse(raw)
  }

  it('is the strict-params method orchestration.taskShow', () => {
    expect(TASK_SHOW_METHOD.name).toBe('orchestration.taskShow')
    expect(TASK_SHOW_METHOD.params).toBe(TaskShowParams)
  })

  it('shows a routed task with no attempt and no executor result', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedRoutedTask({ owner: harness.db, runId: harness.runId })
    const result = await show({ taskId })
    expect(result.task).toMatchObject({ taskId, phase: 'ready', waitable: false })
    expect(result.task.route).toEqual({
      status: 'available',
      target: 'claude_subagent',
      delegated: true,
      reasons: []
    })
    expect(result.result).toBeNull()
    expect(harness.ports.readAttemptResult).not.toHaveBeenCalled()
  })

  it('shows only the bounded, masked native worker result, marked untrusted', async () => {
    harness = createTaskApiHarness()
    const { taskId, routeId } = seedRoutedTask(
      { owner: harness.db, runId: harness.runId },
      { route: { target: 'codex_cli', model: 'gpt-6.1-sol' } }
    )
    const { dispatch } = harness.db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: 3,
      taskId,
      startOptions: { nativeTask: true, route_id: routeId }
    })
    const dispatchId = dispatch.id
    harness.ports.readAttemptResult.mockResolvedValueOnce(OK_RESULT)
    const result = await show({ taskId })
    expect(harness.ports.readAttemptResult).toHaveBeenCalledWith(dispatchId)
    expect(result.result).toEqual({
      state: 'ok',
      text: OK_RESULT.text,
      truncated: false,
      secretsMasked: false,
      bytes: OK_RESULT.bytes,
      sha256: OK_RESULT.sha256,
      untrusted: true
    })
    expect(result.task.attempt).toMatchObject({
      attemptId: dispatchId,
      runsIn: 'process',
      nativeWorker: true
    })
  })

  it('reads no result for an in-session attempt', async () => {
    harness = createTaskApiHarness()
    const { taskId, dispatchId } = seedInSessionAttempt(harness)
    const result = await show({ taskId })
    expect(result.task).toMatchObject({ phase: 'running', waitable: false })
    expect(result.task.attempt).toMatchObject({ attemptId: dispatchId, runsIn: 'session' })
    expect(result.result).toBeNull()
  })

  it('waits in one slice until the classification lands', async () => {
    harness = createTaskApiHarness()
    const current = harness
    const { taskId } = seedTask({ owner: current.db, runId: current.runId })
    current.classifier.classify(taskId)
    let sleeps = 0
    current.ports.sleep.mockImplementation(async (ms: number) => {
      current.clock.ms += ms
      sleeps += 1
      if (sleeps === 3) {
        classify(current, taskId)
      }
    })
    const result = await show({ taskId, waitMs: 20_000 })
    expect(result.task.phase).toBe('ready')
    expect(sleeps).toBe(3)
  })

  it('returns within the requested wait when nothing changes', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    harness.classifier.classify(taskId)
    const startedAt = harness.clock.ms
    const result = await show({ taskId, waitMs: 5_000 })
    expect(result.task.phase).toBe('classifying')
    expect(harness.clock.ms - startedAt).toBeLessThanOrEqual(5_000)
    expect(harness.clock.ms - startedAt).toBeGreaterThan(0)
  })

  it('does not wait on a phase only the primary can move', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedInSessionAttempt(harness)
    await show({ taskId, waitMs: 20_000 })
    expect(harness.ports.sleep).not.toHaveBeenCalled()
  })

  it('stops waiting when the client goes away', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    harness.classifier.classify(taskId)
    const abort = new AbortController()
    abort.abort()
    const result = await show(
      { taskId, waitMs: 20_000 },
      { ...harness.context, signal: abort.signal }
    )
    expect(result.task.phase).toBe('classifying')
    expect(harness.ports.sleep).not.toHaveBeenCalled()
  })

  it('reads a task after the run stopped taking new work', async () => {
    harness = createTaskApiHarness()
    const { taskId } = seedTask({ owner: harness.db, runId: harness.runId })
    moveRun(harness, 'completing')
    await expect(show({ taskId })).resolves.toBeDefined()
  })

  it('refuses a task of another run and any other caller', async () => {
    harness = createTaskApiHarness()
    const foreign = harness.db.createRun({
      objective: 'Other run.',
      coordinatorHandle: null,
      coordinatorPaneKey: null
    })
    const other = harness.db.createTask({ spec: 'Other task.', runId: foreign.id })
    await expect(show({ taskId: other.id })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.taskNotInRun
    })
    harness.setAuthority(null)
    await expect(show({ taskId: other.id })).rejects.toMatchObject({
      code: AUTOPILOT_TASK_API_ERROR_CODES.callerRefused
    })
  })
})

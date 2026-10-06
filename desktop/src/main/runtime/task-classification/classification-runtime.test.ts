import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { getTaskClassificationStore } from '../orchestration/db/task-classification-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { transportHeldUntilReleased } from '../workbench-routing/clef-scripted-transport.test-fixture'
import { fixtureClassifyTime, proposeFixtureTask } from './classification-db.test-fixture'
import {
  createClassifierHarness,
  fixtureRouting,
  type ClassifierHarness
} from './classification-deps.test-fixture'
import {
  createTaskClassificationRuntime,
  getTaskClassificationRuntime,
  setTaskClassificationRuntime,
  type ClassificationSettled,
  type TaskClassificationRuntimeDeps
} from './classification-runtime'

// FIXTURE_ONLY: scripted, held Clef answers over a memory database; no network.
const PENDING_BUDGET_MS = 50

describe('the TaskSpec classification runtime', () => {
  let harness: ClassifierHarness | null = null

  beforeEach(() => setClefCallCircuit(null))
  afterEach(() => {
    harness?.db.owner.close()
    harness = null
    setClefCallCircuit(null)
    setTaskClassificationRuntime(null)
  })

  function runtimeFor(
    h: ClassifierHarness,
    overrides: Partial<TaskClassificationRuntimeDeps> = {}
  ) {
    return createTaskClassificationRuntime({
      owner: h.db.owner,
      ledger: h.ledger,
      credentials: h.deps.credentials,
      verifiedProfile: h.deps.verifiedProfile,
      transport: h.deps.transport,
      routing: h.deps.routing,
      clock: h.deps.clock,
      ...overrides
    })
  }

  it('returns a pending handle within 50 ms while the call is in flight; the result lands in the store', async () => {
    const held = transportHeldUntilReleased()
    harness = createClassifierHarness({ transport: held.transport })
    const runtime = runtimeFor(harness)
    const task = proposeFixtureTask(harness.db)
    const started = performance.now()
    const pending = runtime.classify(task.taskId)
    expect(performance.now() - started).toBeLessThanOrEqual(PENDING_BUDGET_MS)
    expect(pending).toMatchObject({ status: 'pending', taskId: task.taskId })
    await held.inFlight
    const store = getTaskClassificationStore(harness.db.owner)
    expect(store.latestForTask(task.taskId)).toBeNull()
    expect(runtime.classify(task.taskId)).toBe(pending)
    held.release()
    const settled = await pending.settled
    expect(settled).toMatchObject({
      status: 'recorded',
      taskId: task.taskId,
      classification: { outcome: 'classified', needsDelegation: true }
    })
    expect(store.latestForTask(task.taskId)?.outcome).toBe('classified')
    expect(runtime.pending(task.taskId)).toBeNull()
  })

  it('records a canceled classification as discarded_after_cancel', async () => {
    const held = transportHeldUntilReleased()
    harness = createClassifierHarness({ transport: held.transport })
    const runtime = runtimeFor(harness)
    const task = proposeFixtureTask(harness.db)
    const pending = runtime.classify(task.taskId)
    await held.inFlight
    expect(runtime.cancel(task.taskId)).toBe(true)
    held.release()
    expect(await pending.settled).toMatchObject({
      status: 'recorded',
      classification: { outcome: 'discarded_after_cancel', detail: 'interrupted' }
    })
    expect(runtime.cancel(task.taskId)).toBe(false)
  })

  it('records a shutdown abort as interrupted before anything is sent', async () => {
    harness = createClassifierHarness()
    const runtime = runtimeFor(harness)
    const task = proposeFixtureTask(harness.db)
    const pending = runtime.classify(task.taskId)
    expect(runtime.abortAll()).toBe(1)
    expect(await pending.settled).toMatchObject({
      classification: { outcome: 'blocked', detail: 'interrupted' }
    })
    expect(harness.transport.calls()).toBe(0)
  })

  it('refuses at once a task without a TaskSpec or outside an active run', () => {
    harness = createClassifierHarness()
    const runtime = runtimeFor(harness)
    expect(() => runtime.classify('task_fixture_missing')).toThrow(OrchestrationError)
    const task = proposeFixtureTask(harness.db)
    getWorkflowRunStore(harness.db.owner).transition({
      runId: harness.db.runId,
      from: 'active',
      to: 'canceled',
      expectedRevision: 2,
      reason: 'fixture_cancel',
      timestamp: fixtureClassifyTime(5)
    })
    expect(() => runtime.classify(task.taskId)).toThrow(/active/)
  })

  it('reports each settlement once and turns an unexpected error into a failed result', async () => {
    harness = createClassifierHarness()
    const onSettled = vi.fn<(settled: ClassificationSettled) => void>()
    const onFailure = vi.fn()
    const routing = fixtureRouting()
    const runtime = runtimeFor(harness, {
      routing: {
        activeTable: routing.port.activeTable,
        resolveRoute: () => Promise.reject(new Error('fixture lookup failure'))
      },
      onSettled,
      onFailure
    })
    const task = proposeFixtureTask(harness.db)
    const settled = await runtime.classify(task.taskId).settled
    expect(settled).toEqual({
      status: 'failed',
      taskId: task.taskId,
      code: 'autopilot_classification_failed'
    })
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith(settled)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('settles under a synchronous scheduler even when the failure sink throws', async () => {
    harness = createClassifierHarness()
    const routing = fixtureRouting()
    const runtime = runtimeFor(harness, {
      schedule: (task) => task(),
      routing: {
        activeTable: routing.port.activeTable,
        resolveRoute: () => Promise.reject(new Error('fixture lookup failure'))
      },
      onFailure: () => {
        throw new Error('fixture sink failure')
      }
    })
    const task = proposeFixtureTask(harness.db)
    const pending = runtime.classify(task.taskId)
    expect(await pending.settled).toMatchObject({ status: 'failed', taskId: task.taskId })
    expect(runtime.pending(task.taskId)).toBeNull()
  })

  it('settles as failed and forgets the task when the scheduler throws', async () => {
    harness = createClassifierHarness()
    const onSettled = vi.fn<(settled: ClassificationSettled) => void>()
    const onFailure = vi.fn()
    const runtime = runtimeFor(harness, {
      schedule: () => {
        throw new Error('fixture scheduler failure')
      },
      onSettled,
      onFailure
    })
    const task = proposeFixtureTask(harness.db)
    const pending = runtime.classify(task.taskId)
    const failed = {
      status: 'failed',
      taskId: task.taskId,
      code: 'autopilot_classification_failed'
    }
    expect(await pending.settled).toEqual(failed)
    expect(runtime.pending(task.taskId)).toBeNull()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(failed)
  })

  it('classifies with no daily classification cap to configure (D-022)', async () => {
    const h = createClassifierHarness()
    harness = h
    const runtime = runtimeFor(h)
    const tasks = [1, 2, 3].map(() => proposeFixtureTask(h.db))
    for (const task of tasks) {
      expect(await runtime.classify(task.taskId).settled).toMatchObject({
        status: 'recorded',
        classification: { outcome: 'classified' }
      })
    }
  })

  it('is installed and removed by startup', () => {
    harness = createClassifierHarness()
    const runtime = runtimeFor(harness)
    expect(getTaskClassificationRuntime()).toBeNull()
    setTaskClassificationRuntime(runtime)
    expect(getTaskClassificationRuntime()).toBe(runtime)
  })
})

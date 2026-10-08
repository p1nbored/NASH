import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { getValidationOutcomeService } from './app-attempt-validation-outcome'
import { getTaskValidationStore } from './task-validation-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// The headline behavior of D-016: an executor saying done is never enough, and the one path that
// completes a task is a passing validation through Orca's own status update.
describe('app attempt lifecycle against Orca', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const status = (taskId: string) => harness.owner.getTask(taskId)?.status

  const start = (seeded: { taskId: string; routeId: string }, retryOf?: string) =>
    settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      retryOf,
      timestamp: fixtureTime(5)
    }).dispatchId
  const run = (dispatchId: string) =>
    settlement().markRunning({
      dispatchId,
      timestamp: fixtureTime(6)
    })
  const claim = (dispatchId: string) =>
    settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
  const openChecks = (taskId: string, dispatchId: string) =>
    getTaskValidationStore(harness.owner).open({
      taskId,
      dispatchId,
      policy: 'machine_checks',
      validatorId: 'deterministic_validators',
      workerModel: null,
      reviewerModel: null,
      timestamp: fixtureTime(8)
    }).record.validationId
  const verdict = (validationId: string, value: 'pass' | 'fail') =>
    getValidationOutcomeService(harness.owner).recordVerdict({
      validationId,
      verdict: value,
      checks: [{ kind: 'artifact_exists', status: value }],
      evidenceRefs: value === 'pass' ? [{ kind: 'artifact', ref: 'report.md' }] : [],
      timestamp: fixtureTime(9)
    })
  const oneCheck = { spec: { machineChecks: [{ kind: 'artifact_exists', path: 'report.md' }] } }

  it('never completes a task on a claim, and keeps dependents pending until a validation passes', () => {
    const first = seedRoutedTask(harness, oneCheck)
    const second = seedRoutedTask(harness, { deps: [first.taskId] })
    const third = seedRoutedTask(harness, { deps: [second.taskId] })
    const dispatchId = start(first)
    run(dispatchId)
    claim(dispatchId)
    expect(status(first.taskId)).toBe('blocked')
    expect(status(second.taskId)).toBe('pending')
    expect(status(third.taskId)).toBe('pending')
    // The dependent cannot start, and the claimed task cannot be started a second time.
    expect(errorCodeOf(() => start(second))).toBe('task_not_startable')
    expect(errorCodeOf(() => start(first))).toBe('task_not_startable')
    expect(errorCodeOf(() => start(first, dispatchId))).toBe('task_not_startable')

    verdict(openChecks(first.taskId, dispatchId), 'pass')
    expect(status(first.taskId)).toBe('completed')
    expect(status(second.taskId)).toBe('ready')
    expect(status(third.taskId)).toBe('pending')

    const secondDispatch = start(second)
    run(secondDispatch)
    claim(secondDispatch)
    expect(status(third.taskId)).toBe('pending')
  })

  it('moves a task whose validation failed to failed, and retries it from the failed attempt', () => {
    const seeded = seedRoutedTask(harness, oneCheck)
    const dependent = seedRoutedTask(harness, { deps: [seeded.taskId] })
    const first = start(seeded)
    run(first)
    claim(first)
    verdict(openChecks(seeded.taskId, first), 'fail')
    expect(status(seeded.taskId)).toBe('failed')
    expect(status(dependent.taskId)).toBe('pending')

    const retry = start(seeded, first)
    expect(harness.owner.getDispatchContextById(retry)).toMatchObject({
      retry_of_dispatch_id: first,
      status: 'pending'
    })
    expect(status(seeded.taskId)).toBe('dispatched')
    run(retry)
    claim(retry)
    verdict(openChecks(seeded.taskId, retry), 'pass')
    expect(status(seeded.taskId)).toBe('completed')
    expect(status(dependent.taskId)).toBe('ready')
  })

  it('retries a task whose executor failed, from the failed attempt', () => {
    const seeded = seedRoutedTask(harness)
    const first = start(seeded)
    run(first)
    settlement().settleFailure({
      dispatchId: first,
      outcome: 'failed',
      reason: 'executor_failed',
      timestamp: fixtureTime(7)
    })
    expect(status(seeded.taskId)).toBe('failed')
    expect(start(seeded, first)).not.toBe(first)
    expect(status(seeded.taskId)).toBe('dispatched')
  })

  it('retries a task whose start failed, from the failed attempt', () => {
    const seeded = seedRoutedTask(harness)
    const first = start(seeded)
    settlement().markStartFailed({
      dispatchId: first,
      reason: 'spawn_failed',
      timestamp: fixtureTime(6)
    })
    expect(start(seeded, first)).not.toBe(first)
  })

  it('refuses to retry an attempt whose validation is still pending', () => {
    const seeded = seedRoutedTask(harness, oneCheck)
    const first = start(seeded)
    run(first)
    claim(first)
    expect(errorCodeOf(() => start(seeded, first))).toBe('task_not_startable')
    expect(status(seeded.taskId)).toBe('blocked')
  })

  it('has no way to complete a task other than a passing verdict', () => {
    const seeded = seedRoutedTask(harness, oneCheck)
    const dispatchId = start(seeded)
    run(dispatchId)
    claim(dispatchId)
    const validationId = openChecks(seeded.taskId, dispatchId)
    // An inconclusive verdict never completes the task.
    getValidationOutcomeService(harness.owner).recordVerdict({
      validationId,
      verdict: 'inconclusive',
      checks: [{ kind: 'artifact_exists', status: 'inconclusive' }],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
    expect(status(seeded.taskId)).toBe('blocked')
    expect(getTaskValidationStore(harness.owner).hasPassing(seeded.taskId)).toBe(false)
    expect(harness.owner.getTask(seeded.taskId)?.completed_at).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { getValidationOutcomeService } from './app-attempt-validation-outcome'
import { getTaskValidationStore } from './task-validation-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { FIXTURE_HASH_B, errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const CLAIM = {
  exitCode: 0,
  tree: EXITED,
  lastMessage: { sha256: FIXTURE_HASH_B, bytes: 120, secretLike: false }
}

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
      executor: 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      retryOf,
      timestamp: fixtureTime(5)
    }).dispatchId
  const run = (dispatchId: string) =>
    settlement().markRunning({
      dispatchId,
      executableEvidence: { executable: 'codex' },
      timestamp: fixtureTime(6)
    })
  const claim = (dispatchId: string) =>
    settlement().settleClaim({ dispatchId, ...CLAIM, timestamp: fixtureTime(7) })
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
      evidenceRefs:
        value === 'pass' ? [{ kind: 'executor_last_message', ref: FIXTURE_HASH_B }] : [],
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
      tree: EXITED,
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

  it('retries a stopped task, which is blocked, from the stopped attempt', () => {
    const seeded = seedRoutedTask(harness)
    const first = start(seeded)
    run(first)
    settlement().settleStop({
      dispatchId: first,
      stopVerdict: 'exited',
      reason: 'user_stop',
      timestamp: fixtureTime(7)
    })
    expect(status(seeded.taskId)).toBe('blocked')
    expect(harness.owner.getDispatchContextById(start(seeded, first))?.retry_of_dispatch_id).toBe(
      first
    )
  })

  it('refuses to retry while a start or a stop is of unknown outcome, until the user abandons it', () => {
    const unknownStart = seedRoutedTask(harness)
    const startDispatch = start(unknownStart)
    settlement().markStartUnknown({
      dispatchId: startDispatch,
      reason: 'restart',
      timestamp: fixtureTime(6)
    })
    expect(errorCodeOf(() => start(unknownStart, startDispatch))).toBe('task_not_startable')

    const unknownStop = seedRoutedTask(harness)
    const stopDispatch = start(unknownStop)
    run(stopDispatch)
    settlement().settleStop({
      dispatchId: stopDispatch,
      stopVerdict: 'unverifiable',
      reason: 'restart',
      timestamp: fixtureTime(7)
    })
    expect(errorCodeOf(() => start(unknownStop, stopDispatch))).toBe('task_not_startable')

    harness.owner.abandonWorkerDispatch(stopDispatch, 'fixture_epoch', 'fixture_user')
    expect(
      harness.owner.getDispatchContextById(start(unknownStop, stopDispatch))?.retry_of_dispatch_id
    ).toBe(stopDispatch)
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
    // A failing or inconclusive verdict, a decision to reject, or a stop never completes it.
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

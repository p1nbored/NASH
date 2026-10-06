// FIXTURE_ONLY: synthetic runs, attempts and ids; no real terminal, process or network.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_RUN_POLICY_ERROR_CODES } from '../../../workflow-run/app-run-policy'
import { OrchestrationDb } from '../orchestration-db'
import { getAppAttemptSettlement } from '../app-attempt-settlement'
import { seedRoutedTask } from '../app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from '../app-attempt.test-fixture'
import { errorCodeOf, fixtureTime, readSchemaEntries } from '../autopilot-runtime.test-fixture'

const REFUSED = APP_RUN_POLICY_ERROR_CODES.reportRefused

// Why: settleWorkerReport has no authority check of its own; only a null assignee kept app attempts
// out, so the tests give the dispatch an assignee, which is the probe that makes the gap real.
describe('settleWorkerReport against app attempts', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)

  function startAttempt() {
    const seeded = seedRoutedTask(harness)
    const view = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    harness.owner.db
      .prepare("UPDATE dispatch_contexts SET assignee_handle = 'term_assignee' WHERE id = ?")
      .run(view.dispatchId)
    return { taskId: seeded.taskId, dispatchId: view.dispatchId }
  }
  function runningAttempt() {
    const attempt = startAttempt()
    settlement().markRunning({
      dispatchId: attempt.dispatchId,
      executableEvidence: { executable: 'codex' },
      timestamp: fixtureTime(6)
    })
    return attempt
  }

  const report = (attempt: { taskId: string; dispatchId: string }) =>
    harness.owner.settleWorkerReport({
      taskId: attempt.taskId,
      dispatchId: attempt.dispatchId,
      outcome: 'succeeded',
      result: 'done, per the executor'
    })

  const rowsOf = (attempt: { taskId: string; dispatchId: string }) => ({
    task: harness.owner.getTask(attempt.taskId)?.status,
    dispatch: harness.owner.getDispatchContextById(attempt.dispatchId)?.status,
    worker: harness.owner.getWorkerDispatch(attempt.dispatchId)?.state
  })

  it('refuses a succeeded report for a running attempt and leaves every row alone', () => {
    const attempt = runningAttempt()
    const before = rowsOf(attempt)

    expect(errorCodeOf(() => report(attempt))).toBe(REFUSED)

    expect(rowsOf(attempt)).toEqual(before)
    expect(before.task).toBe('dispatched')
  })

  it('refuses a report for an attempt whose start outcome is unknown, which a report would reconnect', () => {
    const attempt = startAttempt()
    settlement().markStartUnknown({
      dispatchId: attempt.dispatchId,
      reason: 'restart',
      timestamp: fixtureTime(6)
    })
    const before = rowsOf(attempt)

    expect(errorCodeOf(() => report(attempt))).toBe(REFUSED)

    expect(rowsOf(attempt)).toEqual(before)
    expect(before).toEqual({ task: 'blocked', dispatch: 'pending', worker: 'start_unknown' })
  })

  it('refuses a failed report too, since the executor row is the only authority on the outcome', () => {
    const attempt = runningAttempt()

    const code = errorCodeOf(() =>
      harness.owner.settleWorkerReport({
        taskId: attempt.taskId,
        dispatchId: attempt.dispatchId,
        outcome: 'failed',
        result: 'reported failure'
      })
    )

    expect(code).toBe(REFUSED)
  })

  it('refuses through the in-transaction entry used by the legacy and federation callers', () => {
    const attempt = runningAttempt()
    const before = rowsOf(attempt)

    harness.owner.db.exec('BEGIN IMMEDIATE')
    try {
      const code = errorCodeOf(() =>
        harness.owner.settleWorkerReportInTransaction({
          taskId: attempt.taskId,
          dispatchId: attempt.dispatchId,
          outcome: 'succeeded',
          result: 'done'
        })
      )
      expect(code).toBe(REFUSED)
    } finally {
      harness.owner.db.exec('ROLLBACK')
    }

    expect(rowsOf(attempt)).toEqual(before)
  })

  describe('a dispatch without an executor row', () => {
    it('settles exactly as before, even inside an app run that has attempts', () => {
      runningAttempt()
      const plainTask = harness.owner.createTask({ spec: 'plain work', runId: harness.runId })
      const started = harness.owner.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER,
        taskId: plainTask.id,
        startOptions: {}
      })
      harness.owner.markWorkerDispatchReady(started.dispatch.id)

      const settled = harness.owner.settleWorkerReport({
        taskId: plainTask.id,
        dispatchId: started.dispatch.id,
        outcome: 'succeeded',
        result: 'plain result'
      })

      expect(settled).toEqual({ action: 'settled', outcome: 'succeeded', duplicate: false })
      expect(harness.owner.getTask(plainTask.id)?.status).toBe('completed')
    })

    it('still rejects an unknown dispatch with its own code', () => {
      const attempt = runningAttempt()

      expect(
        harness.owner.settleWorkerReport({
          taskId: attempt.taskId,
          dispatchId: 'ctx_missing',
          outcome: 'succeeded',
          result: 'done'
        })
      ).toMatchObject({ action: 'rejected', code: 'unknown_dispatch' })
    })
  })

  describe('a database that never recorded an app run', () => {
    it('settles exactly as before and creates no table', () => {
      const plain = new OrchestrationDb(':memory:')
      try {
        const run = plain.createRun({
          objective: 'Plain',
          coordinatorHandle: 'term_coord',
          coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        })
        const task = plain.createTask({ spec: 'plain work', runId: run.id })
        const started = plain.createStartingWorkerDispatch({
          creator: { kind: 'system' },
          maxDepth: Number.MAX_SAFE_INTEGER,
          taskId: task.id,
          startOptions: {}
        })
        plain.markWorkerDispatchReady(started.dispatch.id)
        const entriesBefore = readSchemaEntries(plain.db)

        const settled = plain.settleWorkerReport({
          taskId: task.id,
          dispatchId: started.dispatch.id,
          outcome: 'succeeded',
          result: 'plain result'
        })

        expect(settled).toEqual({ action: 'settled', outcome: 'succeeded', duplicate: false })
        expect(plain.getTask(task.id)?.status).toBe('completed')
        expect(readSchemaEntries(plain.db)).toEqual(entriesBefore)
      } finally {
        plain.close()
      }
    })
  })
})

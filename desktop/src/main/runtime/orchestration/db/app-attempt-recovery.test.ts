import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planLegacyWorkerTerminalRecovery } from '../orchestration-legacy-worker-terminal-recovery'
import type { LegacyWorkerTerminalRecoveryRow } from '../types'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { getAttemptArtifactStore } from './attempt-artifact-store'
import { getTaskClassificationStore } from './task-classification-store'
import { getTaskRouteStore } from './task-route-store'
import { getTaskSpecStore } from './task-spec-store'
import { getTaskValidationStore } from './task-validation-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { FIXTURE_HASH_A, errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const INCARNATION_ID = '22222222-2222-4222-8222-222222222222'

describe('app attempts against Orca recovery and reset', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const startAttempt = () => {
    const seeded = seedRoutedTask(harness)
    const view = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    return { ...seeded, dispatchId: view.dispatchId }
  }
  const runAttempt = () => {
    const attempt = startAttempt()
    settlement().markRunning({
      dispatchId: attempt.dispatchId,
      timestamp: fixtureTime(6)
    })
    return attempt
  }
  const claimedAttempt = () => {
    const attempt = runAttempt()
    settlement().settleClaim({
      dispatchId: attempt.dispatchId,
      timestamp: fixtureTime(7)
    })
    return attempt
  }

  describe('legacy worker terminal recovery', () => {
    // Why: the legacy plan adopts only a worker with a pane, a terminal handle and a process; an app
    // attempt has none, so it must come out of the plan as neither adopted nor ambiguous.
    const legacyRow = (
      overrides: Partial<LegacyWorkerTerminalRecoveryRow> = {}
    ): LegacyWorkerTerminalRecoveryRow => ({
      dispatch_id: 'dispatch-legacy',
      task_id: 'task-legacy',
      dispatch_status: 'dispatched',
      contract_version: 0,
      assignee_handle: 'term-worker',
      assignee_pane_key: `tab-worker:${LEAF_ID}`,
      process_incarnation: `ssh:ssh-1@@pty-worker:${INCARNATION_ID}`,
      worker_state: 'ready',
      worktree_id: 'repo::/workspace',
      agent_terminal_handle: 'term-worker',
      ...overrides
    })

    it('lists app attempts in every unsettled worker state and plans none of them', () => {
      const starting = startAttempt()
      const runningAttempt = runAttempt()
      const claimed = claimedAttempt()
      const stopping = runAttempt()
      harness.owner.beginWorkerStop(stopping.dispatchId, 'fixture_epoch')

      const rows = harness.owner.listLegacyWorkerTerminalRecoveryRows()
      const states = new Map(rows.map((row) => [row.dispatch_id, row.worker_state]))
      expect(states.get(starting.dispatchId)).toBe('starting')
      expect(states.get(runningAttempt.dispatchId)).toBe('ready')
      expect(states.get(claimed.dispatchId)).toBe('ready')
      expect(states.get(stopping.dispatchId)).toBe('stopping')
      for (const row of rows) {
        expect(row).toMatchObject({
          assignee_handle: null,
          assignee_pane_key: null,
          process_incarnation: null,
          worktree_id: null,
          agent_terminal_handle: null
        })
      }
      expect(planLegacyWorkerTerminalRecovery(rows)).toEqual({
        candidates: [],
        ambiguousDispatchIds: []
      })
    })

    it('does not make a real legacy worker ambiguous, nor stop adopting it', () => {
      startAttempt()
      runAttempt()
      claimedAttempt()
      const rows = [...harness.owner.listLegacyWorkerTerminalRecoveryRows(), legacyRow()]
      const plan = planLegacyWorkerTerminalRecovery(rows)
      expect(plan.candidates).toEqual([expect.objectContaining({ dispatchId: 'dispatch-legacy' })])
      expect(plan.ambiguousDispatchIds).toEqual([])
    })

    it('stops listing an attempt once it settles', () => {
      const attempt = runAttempt()
      settlement().settleFailure({
        dispatchId: attempt.dispatchId,
        outcome: 'failed',
        reason: 'executor_failed',
        timestamp: fixtureTime(7)
      })
      const listed = harness.owner
        .listLegacyWorkerTerminalRecoveryRows()
        .map((row) => row.dispatch_id)
      expect(listed).not.toContain(attempt.dispatchId)
    })
  })

  describe('after an Orca reset', () => {
    function everySideRow() {
      const attempt = claimedAttempt()
      const artifact = getAttemptArtifactStore(harness.owner).record({
        dispatchId: attempt.dispatchId,
        kind: 'report',
        root: 'worktree',
        relativePath: 'report.md',
        sha256: FIXTURE_HASH_A,
        sizeBytes: 10,
        timestamp: fixtureTime(8)
      }).record
      const validation = getTaskValidationStore(harness.owner).open({
        taskId: attempt.taskId,
        dispatchId: attempt.dispatchId,
        policy: 'machine_checks',
        validatorId: 'deterministic_validators',
        workerModel: null,
        reviewerModel: null,
        timestamp: fixtureTime(8)
      }).record
      const running = runAttempt()
      return { attempt, artifact, validation, running }
    }
    const readAll = (rows: ReturnType<typeof everySideRow>) => ({
      spec: getTaskSpecStore(harness.owner).get(rows.attempt.taskId),
      classification: getTaskClassificationStore(harness.owner).get(rows.attempt.classificationId),
      route: getTaskRouteStore(harness.owner).get(rows.attempt.routeId),
      artifact: getAttemptArtifactStore(harness.owner).get(rows.artifact.artifactId),
      validation: getTaskValidationStore(harness.owner).get(rows.validation.validationId)
    })

    it('reads every side row as live before the reset', () => {
      const all = readAll(everySideRow())
      for (const record of Object.values(all)) {
        expect(record?.orphaned).toBe(false)
      }
    })

    it.each([['resetAll'], ['resetTasks']] as const)(
      'reads every side row as orphaned after %s',
      (reset) => {
        const rows = everySideRow()
        harness.owner[reset]()
        expect(harness.owner.getTask(rows.attempt.taskId)).toBeUndefined()
        const all = readAll(rows)
        for (const record of Object.values(all)) {
          expect(record?.orphaned).toBe(true)
        }
        // The rows themselves are kept as evidence; only their reading changes.
        expect(all.validation).toMatchObject({ verdict: 'pending' })
      }
    )

    it('does not list an orphaned attempt as waiting for validation, nor count its pass', () => {
      const rows = everySideRow()
      expect(settlement().listAwaitingValidation(10)).toHaveLength(1)
      harness.owner.resetAll()
      expect(settlement().listAwaitingValidation(10)).toEqual([])
      expect(getTaskValidationStore(harness.owner).hasPassing(rows.attempt.taskId)).toBe(false)
    })

    it('refuses every settlement after reset, with surviving evidence distinguished from missing attempts', () => {
      const rows = everySideRow()
      harness.owner.resetAll()
      const timestamp = fixtureTime(9)
      const refusals = (dispatchId: string) => [
        () =>
          settlement().markRunning({
            dispatchId,
            timestamp
          }),
        () => settlement().markStartFailed({ dispatchId, reason: 'spawn_failed', timestamp }),
        () =>
          settlement().settleClaim({
            dispatchId,
            timestamp
          }),
        () =>
          settlement().settleFailure({
            dispatchId,
            outcome: 'failed',
            reason: 'executor_failed',
            timestamp
          })
      ]
      for (const refuse of refusals(rows.attempt.dispatchId)) {
        expect(errorCodeOf(refuse)).toBe('autopilot_attempt_orphaned')
      }
      for (const refuse of refusals(rows.running.dispatchId)) {
        expect(errorCodeOf(refuse)).toBe('autopilot_attempt_not_found')
      }
      expect(harness.owner.getTask(rows.running.taskId)).toBeUndefined()
      expect(harness.owner.getWorkerDispatch(rows.running.dispatchId)).toBeUndefined()
    })
  })
})

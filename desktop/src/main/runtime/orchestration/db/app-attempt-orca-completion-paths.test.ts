import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reconcileLifecycleMessage } from '../lifecycle-reconciliation'
import { LEGACY_CONTRACT_VERSION } from './contract-constants'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { getTaskValidationStore } from './task-validation-store'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'

// Why: Orca has two other routes that move a task toward completed; an app attempt must reach neither.
describe('app attempts against the other Orca paths that complete or reopen a task', () => {
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
  const reportDone = (
    attempt: { taskId: string; dispatchId: string },
    sender: { from: string; senderPaneKey?: string }
  ) => {
    const message = harness.owner.insertMessage({
      runId: harness.runId,
      from: sender.from,
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({
        taskId: attempt.taskId,
        dispatchId: attempt.dispatchId,
        outcome: 'succeeded'
      }),
      senderPaneKey: sender.senderPaneKey
    })
    return reconcileLifecycleMessage(harness.owner, message)
  }
  const SENDERS = [
    { from: 'term_any_handle' },
    { from: 'term_any_handle', senderPaneKey: `tab_any:${LEAF_ID}` }
  ]
  const hasPassingValidation = (taskId: string) =>
    getTaskValidationStore(harness.owner).hasPassing(taskId)

  describe('a worker_done report', () => {
    it.each([
      ['running', runAttempt, 'dispatched'],
      ['awaiting validation', claimedAttempt, 'blocked']
    ] as const)('is refused for an attempt that is %s, whoever sends it', (_name, seed, status) => {
      const attempt = seed()
      for (const sender of SENDERS) {
        expect(reportDone(attempt, sender)).toMatchObject({
          action: 'rejected',
          code: 'sender_not_assignee'
        })
      }
      expect(harness.owner.getTask(attempt.taskId)?.status).toBe(status)
      expect(harness.owner.getDispatchContextById(attempt.dispatchId)?.status).not.toBe('completed')
      expect(hasPassingValidation(attempt.taskId)).toBe(false)
    })

    it('leaves an app attempt without any pane or handle for a sender to match', () => {
      const attempt = runAttempt()
      expect(harness.owner.getDispatchContextById(attempt.dispatchId)).toMatchObject({
        assignee_handle: null,
        assignee_pane_key: null
      })
    })

    // Why: the legacy worker-report operation only settles a Dispatch of the legacy contract.
    it('is not a legacy-contract Dispatch, so the legacy operation never settles it', () => {
      const attempt = runAttempt()
      expect(harness.owner.getDispatchContextById(attempt.dispatchId)?.contract_version).not.toBe(
        LEGACY_CONTRACT_VERSION
      )
    })

    it('is refused by the federation relay, which only settles federated Dispatches', () => {
      const attempt = runAttempt()
      expect(
        errorCodeOf(() =>
          harness.owner.importFederatedRelayItem({
            dispatchId: attempt.dispatchId,
            sequence: 1,
            message: {
              id: 'msg_fixture_relay',
              runId: harness.runId,
              from: 'term_any_handle',
              to: 'term_coordinator',
              subject: 'Done',
              body: 'Done.',
              type: 'worker_done',
              priority: 'normal'
            },
            lifecycle: {
              kind: 'worker_report',
              taskId: attempt.taskId,
              outcome: 'succeeded',
              result: 'Done.'
            }
          })
        )
      ).toBe('dispatch_not_found')
      expect(harness.owner.getTask(attempt.taskId)?.status).toBe('dispatched')
    })
  })

  describe('a decision gate', () => {
    it.each([
      ['running', runAttempt],
      ['awaiting validation', claimedAttempt]
    ] as const)('cannot be opened on an attempt that is %s', (_name, seed) => {
      const attempt = seed()
      const before = harness.owner.getTask(attempt.taskId)?.status
      expect(
        errorCodeOf(() =>
          harness.owner.createGate({ taskId: attempt.taskId, question: 'Which option?' })
        )
      ).toBe('task_not_startable')
      expect(harness.owner.getTask(attempt.taskId)?.status).toBe(before)
    })

    it('reopens a gated task as ready, never completed, and the task then runs a fresh attempt', () => {
      const seeded = seedRoutedTask(harness)
      const gate = harness.owner.createGate({ taskId: seeded.taskId, question: 'Which option?' })
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('blocked')

      harness.owner.resolveGate(gate.id, 'continue')

      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('ready')
      expect(hasPassingValidation(seeded.taskId)).toBe(false)
      const view = settlement().start({
        taskId: seeded.taskId,
        routeId: seeded.routeId,
        executor: 'in_session',
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER,
        timestamp: fixtureTime(5)
      })
      expect(view).toMatchObject({ taskStatus: 'dispatched', workerState: 'starting' })
    })
  })
})

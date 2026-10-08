// FIXTURE_ONLY: synthetic in-session tasks and reports.
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import type { AppRunHarness } from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import { createTaskValidationPort } from './task-validation-port'

export const FIXTURE_REASON = 'The task report could not be verified.'

export type InconclusiveAttempt = {
  readonly taskId: string
  readonly dispatchId: string
  readonly validationId: string
}

/** An in-session report whose validation waits for a decision. */
export function inconclusiveAttempt(
  harness: AppRunHarness,
  options: {
    route?: Partial<TaskRouteInput>
    verdict?: 'inconclusive' | 'pending'
  } = {}
): InconclusiveAttempt {
  const seeded = seedRoutedTask(harness, {
    route: {
      target: 'claude_primary',
      model: null,
      policyLevel: 'inherit',
      cliSetting: null,
      ...options.route
    }
  })
  const settlement = getAppAttemptSettlement(harness.owner)
  const { dispatchId } = settlement.start({
    taskId: seeded.taskId,
    routeId: seeded.routeId,
    executor: 'in_session',
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    timestamp: fixtureTime(5)
  })
  settlement.markRunning({ dispatchId, timestamp: fixtureTime(6) })
  settlement.settleClaim({ dispatchId, timestamp: fixtureTime(7) })
  const port = createTaskValidationPort(harness.owner)
  const { record } = port.open({
    taskId: seeded.taskId,
    dispatchId,
    policy: 'machine_checks',
    validatorId: 'deterministic_validators',
    workerModel: null,
    reviewerModel: null,
    timestamp: fixtureTime(8)
  })
  if ((options.verdict ?? 'inconclusive') === 'inconclusive') {
    port.recordVerdict({
      validationId: record.validationId,
      verdict: 'inconclusive',
      checks: [{ kind: 'session_report', status: 'inconclusive', note: FIXTURE_REASON }],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
  }
  return { taskId: seeded.taskId, dispatchId, validationId: record.validationId }
}

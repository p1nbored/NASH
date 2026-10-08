// FIXTURE_ONLY: synthetic runs, tasks, routes and hashes; no process is started.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import {
  getValidationOutcomeService,
  type RecordVerdictInput
} from './app-attempt-validation-outcome'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'
import { getTaskValidationStore } from './task-validation-store'
import type { TaskRouteInput } from './task-route-store'

const SUBAGENT: Partial<TaskRouteInput> = {
  target: 'claude_subagent',
  model: 'claude-sonnet-5-5',
  policyLevel: 'max',
  cliSetting: null
}
const WORKFLOW: Partial<TaskRouteInput> = {
  target: 'claude_workflow',
  model: null,
  policyLevel: 'inherit',
  cliSetting: null
}
const KEPT_BY_PRIMARY: Partial<TaskRouteInput> = {
  status: 'not_delegated',
  target: null,
  model: null,
  policyLevel: null,
  cliSetting: null,
  availability: null
}
const REPORT_PASS = [{ kind: 'session_report', status: 'pass' }] as const
const CLAIM_REF = { kind: 'session_report_claim', ref: 'message_1' }

// D-027: a TaskSpec with neither machine checks nor a review request passes on its default check.
describe('app attempt validation outcome: the default check (D-027)', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const settlement = () => getAppAttemptSettlement(harness.owner)
  const outcome = () => getValidationOutcomeService(harness.owner)

  function open(taskId: string, dispatchId: string, validatorId: string): string {
    return getTaskValidationStore(harness.owner).open({
      taskId,
      dispatchId,
      policy: 'machine_checks',
      validatorId,
      workerModel: null,
      reviewerModel: null,
      timestamp: fixtureTime(8)
    }).record.validationId
  }

  function inSessionClaim(route: Partial<TaskRouteInput>): {
    taskId: string
    validationId: string
  } {
    const seeded = seedRoutedTask(harness, { spec: { machineChecks: [] }, route })
    const { dispatchId } = settlement().start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement().markRunning({ dispatchId, timestamp: fixtureTime(6) })
    settlement().settleClaim({ dispatchId, timestamp: fixtureTime(7) })
    return {
      taskId: seeded.taskId,
      validationId: open(seeded.taskId, dispatchId, 'session_report')
    }
  }

  const pass = (
    validationId: string,
    checks: RecordVerdictInput['checks'],
    evidenceRefs: RecordVerdictInput['evidenceRefs']
  ): RecordVerdictInput => ({
    validationId,
    verdict: 'pass',
    checks,
    evidenceRefs,
    timestamp: fixtureTime(9)
  })

  it.each([
    ['subagent', SUBAGENT],
    ['workflow', WORKFLOW]
  ])('completes a %s attempt on the primary session report, a claim on record', (_name, route) => {
    const { taskId, validationId } = inSessionClaim(route)
    outcome().recordVerdict(pass(validationId, [...REPORT_PASS], [CLAIM_REF]))
    expect(harness.owner.getTask(taskId)?.status).toBe('completed')
  })

  it('refuses a session-report pass without the claim on record', () => {
    const { validationId } = inSessionClaim(SUBAGENT)
    const refs = [{ kind: 'attempt', ref: 'dispatch_1' }]
    expect(
      errorCodeOf(() => outcome().recordVerdict(pass(validationId, [...REPORT_PASS], refs)))
    ).toBe('autopilot_validation_insufficient')
  })

  it('refuses a session-report pass for a task the primary did itself: restriction 27 stays', () => {
    const { taskId, validationId } = inSessionClaim(KEPT_BY_PRIMARY)
    expect(
      errorCodeOf(() => outcome().recordVerdict(pass(validationId, [...REPORT_PASS], [CLAIM_REF])))
    ).toBe('autopilot_validation_insufficient')
    expect(harness.owner.getTask(taskId)?.status).toBe('blocked')
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime
} from '../orchestration/db/autopilot-runtime.test-fixture'
import {
  createTaskValidationPort,
  createValidationDecisionPort,
  type TaskValidationPort,
  type ValidationDecisionPort
} from './task-validation-port'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const

describe('task validation port', () => {
  let harness: AppRunHarness
  let port: TaskValidationPort
  let decisions: ValidationDecisionPort
  beforeEach(() => {
    harness = createAppRunHarness()
    port = createTaskValidationPort(harness.owner)
    decisions = createValidationDecisionPort(harness.owner)
  })
  afterEach(() => harness.owner.close())

  function claimed() {
    const seeded = seedRoutedTask(harness)
    const settlement = getAppAttemptSettlement(harness.owner)
    const { dispatchId } = settlement.start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement.markRunning({
      dispatchId,
      executableEvidence: { executable: 'codex' },
      timestamp: fixtureTime(6)
    })
    settlement.settleClaim({
      dispatchId,
      exitCode: 0,
      tree: EXITED,
      lastMessage: { sha256: FIXTURE_HASH_B, bytes: 5, secretLike: false },
      timestamp: fixtureTime(7)
    })
    return { ...seeded, dispatchId }
  }
  const openInput = (taskId: string, dispatchId: string) =>
    ({
      taskId,
      dispatchId,
      policy: 'machine_checks',
      validatorId: 'deterministic_validators',
      workerModel: null,
      reviewerModel: null,
      timestamp: fixtureTime(8)
    }) as const

  it('lets a validator do its whole job through the port, ending in a completed task', () => {
    const { taskId, dispatchId } = claimed()
    expect(port.listAwaiting(10)).toEqual([
      {
        taskId,
        runId: harness.runId,
        dispatchId,
        stage: 'validation_pending',
        validationId: null,
        verdict: null
      }
    ])
    const spec = port.getSpec(taskId)
    expect(spec?.machineChecks).toEqual([{ kind: 'artifact_exists', path: 'report.md' }])
    expect(port.getExecutor(dispatchId)).toMatchObject({
      state: 'completed',
      lastMessage: { sha256: FIXTURE_HASH_B }
    })

    const artifact = port.recordArtifact({
      dispatchId,
      kind: 'report',
      root: 'worktree',
      relativePath: 'report.md',
      sha256: FIXTURE_HASH_A,
      sizeBytes: 42,
      timestamp: fixtureTime(8)
    })
    expect(port.listArtifacts(dispatchId)).toEqual([artifact.record])

    const { record } = port.open(openInput(taskId, dispatchId))
    expect(port.listAwaiting(10)).toEqual([
      expect.objectContaining({ validationId: record.validationId, verdict: 'pending' })
    ])
    expect(port.getAwaiting(dispatchId)).toEqual(port.listAwaiting(10)[0])
    expect(port.getAwaiting('ctx_unknown')).toBeNull()
    expect(port.hasPassingValidation(taskId)).toBe(false)

    const result = port.recordVerdict({
      validationId: record.validationId,
      verdict: 'pass',
      checks: [{ kind: 'artifact_exists', status: 'pass' }],
      evidenceRefs: [{ kind: 'artifact', ref: artifact.record.artifactId }],
      timestamp: fixtureTime(9)
    })
    expect(result.attempt.taskStatus).toBe('completed')
    expect(port.getValidation(record.validationId)?.verdict).toBe('pass')
    expect(port.hasPassingValidation(taskId)).toBe(true)
    expect(port.listAwaiting(10)).toEqual([])
    expect(port.getAwaiting(dispatchId)).toBeNull()
  })

  it('offers the validators no way to waive or reject, which belong to the user and dot', () => {
    expect(Object.keys(port).filter((name) => /waive|reject|decision/i.test(name))).toEqual([])
    expect(Object.keys(decisions).sort()).toEqual(['listPendingDecisions', 'reject', 'waive'])
  })

  it('shows an inconclusive result as a pending decision, and lets the decision port settle it', () => {
    const first = claimed()
    const { record } = port.open(openInput(first.taskId, first.dispatchId))
    expect(decisions.listPendingDecisions(10)).toEqual([])
    port.recordVerdict({
      validationId: record.validationId,
      verdict: 'inconclusive',
      checks: [{ kind: 'artifact_exists', status: 'inconclusive' }],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
    expect(decisions.listPendingDecisions(10)).toEqual([
      expect.objectContaining({
        taskId: first.taskId,
        validationId: record.validationId,
        verdict: 'inconclusive'
      })
    ])
    const waived = decisions.waive({
      validationId: record.validationId,
      by: 'desktop_user',
      timestamp: fixtureTime(10)
    })
    expect(waived.attempt.taskStatus).toBe('completed')
    expect(decisions.listPendingDecisions(10)).toEqual([])

    const second = claimed()
    const other = port.open(openInput(second.taskId, second.dispatchId)).record
    port.recordVerdict({
      validationId: other.validationId,
      verdict: 'inconclusive',
      checks: [{ kind: 'artifact_exists', status: 'inconclusive' }],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
    expect(
      decisions.reject({ validationId: other.validationId, by: 'dot', timestamp: fixtureTime(10) })
        .attempt.taskStatus
    ).toBe('failed')
  })

  it("passes the stores' refusals through unchanged", () => {
    const { taskId, dispatchId } = claimed()
    expect(
      errorCodeOf(() => port.open({ ...openInput(taskId, dispatchId), policy: 'model_review' }))
    ).toBe('autopilot_invalid_input')
    expect(
      errorCodeOf(() =>
        port.recordVerdict({
          validationId: 'validation_unknown',
          verdict: 'pass',
          checks: [],
          evidenceRefs: [],
          timestamp: fixtureTime(9)
        })
      )
    ).toBe('autopilot_validation_not_found')
    expect(port.getSpec('task_unknown')).toBeNull()
    expect(port.getExecutor('ctx_unknown')).toBeNull()
    expect(port.getValidation('validation_unknown')).toBeNull()
  })
})

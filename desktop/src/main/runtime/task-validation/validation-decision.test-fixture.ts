// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import type { AppRunHarness } from '../orchestration/db/app-attempt.test-fixture'
import { FIXTURE_HASH_B, fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import { createTaskValidationPort } from './task-validation-port'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const

export const FIXTURE_REASON = 'The attempt worktree is gone, so the artifact could not be checked.'

export const FIXTURE_OWN_WORKTREE = {
  mode: 'own_worktree',
  worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
  branch: 'nash-task-1',
  path: 'C:/fixture/workspaces/nash-task-1',
  baseCommit: '0123456789abcdef0123456789abcdef01234567'
} as const

export type InconclusiveAttempt = {
  readonly taskId: string
  readonly dispatchId: string
  readonly validationId: string
}

/** A Codex attempt, or an in-session one, whose validation ended inconclusive and waits for a decision. */
export function inconclusiveAttempt(
  harness: AppRunHarness,
  options: {
    executor?: 'codex_cli' | 'in_session'
    executableEvidence?: JsonObject
    route?: Partial<TaskRouteInput>
    verdict?: 'inconclusive' | 'pending'
    /** The process tree the claim recorded; exited unless a test says a process may still run. */
    tree?: { verdict: 'exited' | 'live' | 'unverifiable'; method: 'root_exit_only' }
  } = {}
): InconclusiveAttempt {
  const executor = options.executor ?? 'codex_cli'
  const seeded = seedRoutedTask(harness, { route: options.route })
  const settlement = getAppAttemptSettlement(harness.owner)
  const { dispatchId } = settlement.start({
    taskId: seeded.taskId,
    routeId: seeded.routeId,
    executor,
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    timestamp: fixtureTime(5)
  })
  if (executor === 'codex_cli') {
    settlement.markRunning({
      dispatchId,
      executableEvidence: options.executableEvidence ?? { executable: 'codex' },
      timestamp: fixtureTime(6)
    })
    settlement.settleClaim({
      dispatchId,
      exitCode: 0,
      tree: options.tree ?? EXITED,
      lastMessage: { sha256: FIXTURE_HASH_B, bytes: 5, secretLike: false },
      timestamp: fixtureTime(7)
    })
  } else {
    settlement.markRunning({ dispatchId, timestamp: fixtureTime(6) })
    settlement.settleClaim({ dispatchId, timestamp: fixtureTime(7) })
  }
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
      checks: [
        { kind: 'executor_completed', status: 'pass', note: 'The process finished.' },
        { kind: 'artifact_exists', status: 'inconclusive', note: FIXTURE_REASON }
      ],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
  }
  return { taskId: seeded.taskId, dispatchId, validationId: record.validationId }
}

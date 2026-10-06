import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewerResolution } from '../../routing-table/route-resolver'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { createTaskValidationRuntime } from './task-validation-runtime'
import { sha256Of } from './task-validation.test-fixture'
import { reviewerResolution } from './validation-runner.test-fixture'

describe('task validation runtime', () => {
  let harness: AppRunHarness
  let base: string
  beforeEach(() => {
    harness = createAppRunHarness()
    base = mkdtempSync(join(tmpdir(), 'c5-runtime-'))
    mkdirSync(join(base, 'reviews'))
  })
  afterEach(() => {
    harness.owner.close()
    rmSync(base, { recursive: true, force: true })
  })

  function runtime(resolution: ReviewerResolution, claudeLookups: string[]) {
    return createTaskValidationRuntime({
      owner: harness.owner,
      roots: {
        resolveWorkspace: async () => null,
        resolveRunDirectory: (relative) => join(base, 'app-data', relative)
      },
      resolver: { resolveValidationReviewer: async () => resolution, latch: () => {} },
      reviewRunsRoot: join(base, 'reviews'),
      codex: {
        resolveExecutable: () => {
          throw new Error('no codex in tests')
        }
      },
      claude: {
        resolveExecutable: () => {
          claudeLookups.push('claude')
          return null
        }
      }
    })
  }

  it('offers only the validator surface, never a way to waive or reject', () => {
    expect(Object.keys(runtime(reviewerResolution('available'), [])).sort()).toEqual([
      'validateAttempt',
      'validatePending'
    ])
  })

  it('has nothing to do on an empty run', async () => {
    expect(await runtime(reviewerResolution('available'), []).validatePending()).toEqual([])
  })

  it('wires the headless Claude reviewer target to the Claude runner', async () => {
    const lookups: string[] = []
    claimCodexAttempt(harness, join(base, 'app-data'))
    const [report] = await runtime(reviewerResolution('available'), lookups).validatePending()
    expect(lookups).toEqual(['claude'])
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
  })
})

/** A Codex attempt of a TaskSpec that asks for a model review (D-027), claimed with its result on disk. */
function claimCodexAttempt(harness: AppRunHarness, appData: string): void {
  const seeded = seedRoutedTask(harness, { spec: { machineChecks: [], review: 'model' } })
  const settlement = getAppAttemptSettlement(harness.owner)
  const { dispatchId } = settlement.start({
    taskId: seeded.taskId,
    routeId: seeded.routeId,
    executor: 'codex_cli',
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    timestamp: fixtureTime(5)
  })
  const runDir = join(appData, 'autopilot-runs', harness.runId, dispatchId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'last-message.txt'), 'Done.')
  settlement.markRunning({
    dispatchId,
    executableEvidence: { executable: 'codex' },
    timestamp: fixtureTime(6)
  })
  settlement.settleClaim({
    dispatchId,
    exitCode: 0,
    tree: { verdict: 'exited', method: 'windows_descendant_snapshot' },
    lastMessage: { sha256: sha256Of('Done.'), bytes: 5, secretLike: false },
    timestamp: fixtureTime(7)
  })
}

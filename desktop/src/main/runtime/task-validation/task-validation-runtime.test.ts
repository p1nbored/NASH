import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
        resolveWorkspace: async () => ({ path: base, kind: 'git' as const })
      },
      resolver: { resolveValidationReviewer: async () => resolution, latch: () => {} },
      reviewer: {
        resolveInvocation: async (agent) => {
          claudeLookups.push(agent)
          throw new Error('test account unavailable')
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

  it('wires the Claude reviewer target to native account preparation', async () => {
    const lookups: string[] = []
    claimInSessionAttempt(harness)
    const [report] = await runtime(reviewerResolution('available'), lookups).validatePending()
    expect(lookups).toEqual(['claude'])
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
  })
})

/** An in-session attempt whose report asks for an independent review. */
function claimInSessionAttempt(harness: AppRunHarness): void {
  const seeded = seedRoutedTask(harness, {
    spec: { machineChecks: [], review: 'model' },
    route: {
      target: 'claude_subagent',
      model: 'claude-sonnet-5-5',
      policyLevel: 'max',
      cliSetting: null
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
  settlement.markRunning({
    dispatchId,
    timestamp: fixtureTime(6)
  })
  settlement.settleClaim({
    dispatchId,
    notice: { subject: 'Task claimed', body: 'Done.' },
    timestamp: fixtureTime(7)
  })
}

import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import {
  FIXTURE_OBJECTIVE,
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import { createAttemptReader, type ValidationRootsPort } from './attempt-evidence'

const roots: ValidationRootsPort = {
  resolveWorkspace: async (workspaceId) =>
    workspaceId === 'fixture-repo::/fixture/repo'
      ? { path: join('C:', 'fixture', 'repo'), kind: 'git' }
      : null
}

describe('attempt evidence', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  function claim(route: Partial<TaskRouteInput> = {}) {
    const seeded = seedRoutedTask(harness, { route })
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
    const entry = settlement
      .listAwaitingValidation(10)
      .find((item) => item.dispatchId === dispatchId)
    if (!entry) {
      throw new Error('fixture attempt is not awaiting validation')
    }
    return entry
  }

  it('gives an in-session attempt that inherits the coordinator its model and a dated start', async () => {
    const entry = claim({
      target: 'claude_workflow',
      model: null,
      policyLevel: 'inherit'
    })
    const facts = await createAttemptReader(harness.owner, roots).read(entry)
    expect(facts).toMatchObject({
      workModel: 'claude-opus-5-5',
      objective: FIXTURE_OBJECTIVE,
      evidence: { workspace: { path: join('C:', 'fixture', 'repo'), kind: 'git' } }
    })
    expect(facts?.evidence.startedAtMs).toEqual(expect.any(Number))
  })

  it('returns null for an attempt it cannot find', async () => {
    const reader = createAttemptReader(harness.owner, roots)
    expect(
      await reader.read({
        taskId: 'task_missing',
        runId: harness.runId,
        dispatchId: 'ctx_missing',
        stage: 'validation_pending',
        validationId: null,
        verdict: null
      })
    ).toBeNull()
  })

  it('leaves native worker attempts to the native report lifecycle', async () => {
    const entry = claim({
      target: 'claude_workflow',
      model: null,
      policyLevel: 'inherit'
    })
    harness.owner.db
      .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
      .run(JSON.stringify({ nativeTask: true }), entry.dispatchId)
    expect(await createAttemptReader(harness.owner, roots).read(entry)).toBeNull()
  })
})

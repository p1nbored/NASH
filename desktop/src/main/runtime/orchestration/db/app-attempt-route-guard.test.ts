// FIXTURE_ONLY: synthetic runs, tasks and routes; no process is started.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { seedRoutedTask } from './app-attempt-routing.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'
import type { TaskRouteInput } from './task-route-store'

const KEPT_BY_PRIMARY: Partial<TaskRouteInput> = {
  status: 'not_delegated',
  target: null,
  model: null,
  policyLevel: null,
  cliSetting: null,
  availability: null
}

describe('assertDispatchableRoute for a task the primary keeps (U29)', () => {
  let harness: AppRunHarness

  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  function start(seeded: { taskId: string; routeId: string }) {
    return getAppAttemptSettlement(harness.owner).start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: 4,
      timestamp: fixtureTime(10)
    })
  }

  it('admits an in-session attempt on a not_delegated route', () => {
    const seeded = seedRoutedTask(harness, { route: KEPT_BY_PRIMARY })
    expect(start(seeded)).toMatchObject({ workerState: 'starting' })
    expect(harness.owner.getTask(seeded.taskId)?.status).toBe('dispatched')
  })

  it('refuses an in-session attempt on an unavailable delegated route', () => {
    const seeded = seedRoutedTask(harness, {
      route: { status: 'unavailable', reasons: ['auth_failed'] }
    })
    expect(errorCodeOf(() => start(seeded))).toBe('autopilot_route_not_dispatchable')
    expect(harness.owner.getDispatchContext(seeded.taskId)).toBeUndefined()
    expect(harness.owner.getTask(seeded.taskId)?.status).toBe('ready')
  })
})

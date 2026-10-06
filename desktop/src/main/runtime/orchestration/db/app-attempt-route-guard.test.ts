// FIXTURE_ONLY: synthetic runs, tasks and routes; no process is started.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from './app-attempt-settlement'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import { seedRoutedTask, startOrcaDispatch } from './app-attempt-routing.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'
import { getExecutorProcessStore } from './executor-process-store'
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

  function start(
    seeded: { taskId: string; routeId: string },
    executor: 'in_session' | 'codex_cli' | 'agy_cli'
  ) {
    return getAppAttemptSettlement(harness.owner).start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor,
      creator: { kind: 'system' },
      maxDepth: 4,
      timestamp: fixtureTime(10)
    })
  }

  it('admits an in-session attempt on a not_delegated route, with no executor row', () => {
    const seeded = seedRoutedTask(harness, { route: KEPT_BY_PRIMARY })
    const view = start(seeded, 'in_session')
    expect(view).toMatchObject({ workerState: 'starting', executor: null })
    expect(harness.owner.getTask(seeded.taskId)?.status).toBe('dispatched')
  })

  it.each(['codex_cli', 'agy_cli'] as const)(
    'refuses a %s attempt on a not_delegated route and opens nothing',
    (executor) => {
      const seeded = seedRoutedTask(harness, { route: KEPT_BY_PRIMARY })
      expect(errorCodeOf(() => start(seeded, executor))).toBe('autopilot_route_not_dispatchable')
      expect(harness.owner.getDispatchContext(seeded.taskId)).toBeUndefined()
      expect(harness.owner.getTask(seeded.taskId)?.status).toBe('ready')
    }
  )

  it('refuses an executor row for a not_delegated route even when Orca opened a Dispatch', () => {
    const seeded = seedRoutedTask(harness, { route: KEPT_BY_PRIMARY })
    const { dispatchId } = startOrcaDispatch(harness, seeded.taskId, seeded.routeId)
    expect(
      errorCodeOf(() =>
        getExecutorProcessStore(harness.owner).insertStarting({
          dispatchId,
          runId: harness.runId,
          taskId: seeded.taskId,
          executorKind: 'codex_cli',
          routeId: seeded.routeId,
          runDirectory: `autopilot-runs/${harness.runId}/${dispatchId}`,
          timestamp: fixtureTime(11)
        })
      )
    ).toBe('autopilot_route_not_dispatchable')
  })

  it('still refuses an in-session attempt on an unavailable delegated route', () => {
    const seeded = seedRoutedTask(harness, {
      route: {
        target: 'claude_subagent',
        model: 'claude-sonnet-5-5',
        policyLevel: 'max',
        status: 'unavailable',
        reasons: ['auth_failed']
      }
    })
    expect(errorCodeOf(() => start(seeded, 'in_session'))).toBe('autopilot_route_not_dispatchable')
  })
})

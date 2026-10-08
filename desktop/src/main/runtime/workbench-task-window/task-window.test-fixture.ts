// FIXTURE_ONLY: synthetic in-memory dispatches; no provider or app is launched.
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import {
  seedRoutedTask,
  startOrcaDispatch
} from '../orchestration/db/app-attempt-routing.test-fixture'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'

export type TaskWindowHarness = AppRunHarness & { close(): void }
export function createTaskWindowHarness(): TaskWindowHarness {
  const app = createAppRunHarness()
  return { ...app, close: () => app.owner.close() }
}
export function seedNativeAttempt(
  harness: TaskWindowHarness,
  options: {
    route?: Partial<TaskRouteInput>
    sessionId?: string
    terminal?: string
    title?: string
  } = {}
) {
  const { taskId, routeId } = seedRoutedTask(harness, {
    route: { target: 'codex_cli', model: 'gpt-fixture', ...options.route }
  })
  if (options.title) {
    harness.owner.db
      .prepare('UPDATE tasks SET task_title = ? WHERE id = ?')
      .run(options.title, taskId)
  }
  const { dispatch } = harness.owner.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: 4,
    taskId,
    startOptions: { nativeTask: true, route_id: routeId }
  })
  harness.owner.markWorkerDispatchReady(dispatch.id)
  harness.owner.db
    .prepare(
      'UPDATE worker_dispatches SET worktree_id = ?, agent_terminal_handle = ? WHERE dispatch_id = ?'
    )
    .run('fixture-worker-worktree', options.terminal ?? null, dispatch.id)
  if (options.sessionId) {
    harness.owner.db
      .prepare('UPDATE dispatch_contexts SET process_incarnation = ? WHERE id = ?')
      .run(`structured:${options.sessionId}`, dispatch.id)
  }
  return { taskId, dispatchId: dispatch.id }
}
export function seedClaudeTask(harness: TaskWindowHarness, route: Partial<TaskRouteInput>) {
  const { taskId, routeId } = seedRoutedTask(harness, {
    route: { model: 'claude-sonnet-fixture', policyLevel: 'high', cliSetting: null, ...route }
  })
  return { taskId, ...startOrcaDispatch(harness, taskId, routeId) }
}

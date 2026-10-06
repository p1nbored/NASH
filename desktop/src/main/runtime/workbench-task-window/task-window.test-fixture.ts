// FIXTURE_ONLY: every id, path, model and transcript line below is synthetic and describes no real run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import {
  seedRoutedTask,
  seedStartedAttempt,
  startOrcaDispatch
} from '../orchestration/db/app-attempt-routing.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getExecutorProcessStore } from '../orchestration/db/executor-process-store'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'

export type TaskWindowHarness = AppRunHarness & {
  readonly userDataPath: string
  close(): void
}

export function createTaskWindowHarness(): TaskWindowHarness {
  const app = createAppRunHarness()
  const userDataPath = mkdtempSync(join(tmpdir(), 'nash-task-window-'))
  return {
    ...app,
    userDataPath,
    close: () => {
      app.owner.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  }
}

/** A Codex task with one started attempt; its run directory is created, its transcript is not. */
export function seedCodexAttempt(
  harness: TaskWindowHarness,
  options: { runDirectory?: string; title?: string } = {}
): { taskId: string; dispatchId: string; runDir: string } {
  const { taskId, routeId } = seedRoutedTask(harness)
  if (options.title) {
    harness.owner.db
      .prepare('UPDATE tasks SET task_title = ? WHERE id = ?')
      .run(options.title, taskId)
  }
  const { dispatchId } = seedStartedAttempt(harness, taskId, routeId, {
    runDirectory: options.runDirectory
  })
  const record = getExecutorProcessStore(harness.owner).get(dispatchId)
  const runDir = join(harness.userDataPath, record?.runDirectory ?? '')
  mkdirSync(runDir, { recursive: true })
  return { taskId, dispatchId, runDir }
}

/** An agy task with one started attempt on an available agy route. */
export function seedAgyAttempt(harness: TaskWindowHarness): {
  taskId: string
  dispatchId: string
  runDir: string
} {
  const { taskId, routeId } = seedRoutedTask(harness, {
    route: { target: 'agy_cli', model: 'gemini-3.8-flash-high', cliSetting: null }
  })
  const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
  const runDirectory = `autopilot-runs/${harness.runId}/${dispatchId}`
  getExecutorProcessStore(harness.owner).insertStarting({
    dispatchId,
    runId: harness.runId,
    taskId,
    executorKind: 'agy_cli',
    routeId,
    runDirectory,
    timestamp: fixtureTime(4)
  })
  const runDir = join(harness.userDataPath, runDirectory)
  mkdirSync(runDir, { recursive: true })
  return { taskId, dispatchId, runDir }
}

/** A task routed inside the primary session, with Orca's Dispatch and no executor process. */
export function seedClaudeTask(
  harness: TaskWindowHarness,
  route: Partial<TaskRouteInput>
): { taskId: string; dispatchId: string } {
  const { taskId, routeId } = seedRoutedTask(harness, {
    route: { model: 'claude-sonnet-fixture', policyLevel: 'high', cliSetting: null, ...route }
  })
  const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
  return { taskId, dispatchId }
}

/** Settles the executor row the way settlement leaves it; the CHECK requires a settle time. */
export function settleAttempt(
  harness: TaskWindowHarness,
  dispatchId: string,
  state: 'completed' | 'failed' = 'completed'
): void {
  harness.owner.db
    .prepare(
      'UPDATE executor_processes SET state = ?, settled_at = ?, exit_code = ? WHERE dispatch_id = ?'
    )
    .run(state, fixtureTime(9), state === 'completed' ? 0 : 1, dispatchId)
}

export function record(kind: string, seq: number, extra: Record<string, unknown> = {}): string {
  const at = new Date(Date.UTC(2026, 9, 5, 18, 0, seq)).toISOString()
  return `${JSON.stringify({ v: 1, seq, at, kind, ...extra })}\n`
}

export const FIXTURE_START = record('start', 0, {
  executor: 'codex',
  model: 'gpt-6.1-sol',
  effort: 'max',
  sandbox: 'read-only',
  cwd: 'C:/fixtures/autopilot',
  worktree: null
})

export function writeTranscript(runDir: string, content: string | Buffer): string {
  const path = join(runDir, 'transcript.jsonl')
  writeFileSync(path, content)
  return path
}

import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { seedTask } from '../orchestration/db/app-attempt.test-fixture'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import { readRunTasks } from './run-tasks-read'
import {
  createTaskWindowHarness,
  seedNativeAttempt,
  seedClaudeTask,
  type TaskWindowHarness
} from './task-window.test-fixture'
let harness: TaskWindowHarness | null = null
afterEach(() => {
  harness?.close()
  harness = null
})
function setup() {
  harness = createTaskWindowHarness()
  return harness
}
const tasksOf = (h: TaskWindowHarness, runId = h.runId) => readRunTasks({ owner: h.owner }, runId)
describe('readRunTasks', () => {
  it('reads native session and terminal attempts directly from worker dispatches', async () => {
    const h = setup()
    const codex = seedNativeAttempt(h, { title: 'Review the parser', sessionId: 'session-fixture' })
    const agy = seedNativeAttempt(h, {
      route: { target: 'agy_cli', model: 'gemini-3.8-flash-high', cliSetting: null },
      terminal: 'terminal-fixture'
    })
    const { tasks } = await tasksOf(h)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      taskId: codex.taskId,
      title: 'Review the parser',
      executorKind: 'codex',
      attempts: [
        {
          dispatchId: codex.dispatchId,
          state: 'running',
          source: {
            kind: 'session',
            worktreeId: 'fixture-worker-worktree',
            sessionId: 'session-fixture',
            agent: 'codex'
          }
        }
      ]
    })
    expect(tasks[1]).toMatchObject({
      taskId: agy.taskId,
      executorKind: 'agy',
      attempts: [
        { dispatchId: agy.dispatchId, source: { kind: 'terminal', terminal: 'terminal-fixture' } }
      ]
    })
    expect(JSON.stringify(tasks)).not.toMatch(/hasTranscript|runDirectory|autopilot-runs/)
  })
  it('shows native completion without a saved transcript or executor row', async () => {
    const h = setup()
    const { dispatchId } = seedNativeAttempt(h)
    h.owner.db
      .prepare("UPDATE worker_dispatches SET state = 'succeeded' WHERE dispatch_id = ?")
      .run(dispatchId)
    const { tasks } = await tasksOf(h)
    expect(tasks[0].attempts).toEqual([
      expect.objectContaining({ dispatchId, state: 'completed', source: null })
    ])
  })
  it('takes in-session task kinds from their routes and their attempts from dispatches', async () => {
    const h = setup()
    const sub = seedClaudeTask(h, { target: 'claude_subagent' })
    seedClaudeTask(h, { target: 'claude_workflow' })
    const { tasks } = await tasksOf(h)
    expect(tasks.map((task) => task.executorKind)).toEqual(['claude_subagent', 'claude_workflow'])
    expect(tasks[0].attempts).toEqual([
      {
        dispatchId: sub.dispatchId,
        state: 'starting',
        startedAt: expect.any(String),
        settledAt: null,
        source: null
      }
    ])
  })
  it('uses the primary session for tasks without a delegated route', async () => {
    const h = setup()
    seedTask(h)
    seedRoutedTask(h, {
      route: {
        target: null,
        model: null,
        policyLevel: null,
        cliSetting: null,
        status: 'not_delegated'
      }
    })
    expect((await tasksOf(h)).tasks.map((task) => [task.executorKind, task.attempts])).toEqual([
      ['claude_primary', []],
      ['claude_primary', []]
    ])
  })
  it('refuses a run the app does not know', async () => {
    const h = setup()
    await expect(tasksOf(h, 'run_unknown0001')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OrchestrationError && error.code === 'workbench_run_not_found'
    )
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { FIXTURE_OBJECTIVE, seedTask } from '../orchestration/db/app-attempt.test-fixture'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import { readRunTasks } from './run-tasks-read'
import {
  FIXTURE_START,
  createTaskWindowHarness,
  seedAgyAttempt,
  seedClaudeTask,
  seedCodexAttempt,
  settleAttempt,
  writeTranscript,
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

function tasksOf(h: TaskWindowHarness, runId = h.runId) {
  return readRunTasks({ owner: h.owner, userDataPath: h.userDataPath }, runId)
}

describe('readRunTasks', () => {
  it('lists the run tasks in order with executor, attempts and whether a transcript exists', async () => {
    const h = setup()
    const codex = seedCodexAttempt(h, { title: 'Review the parser' })
    writeTranscript(codex.runDir, FIXTURE_START)
    const agy = seedAgyAttempt(h)
    settleAttempt(h, agy.dispatchId)

    const { tasks } = await tasksOf(h)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toEqual({
      taskId: codex.taskId,
      title: 'Review the parser',
      executorKind: 'codex',
      attempts: [
        {
          dispatchId: codex.dispatchId,
          state: 'starting',
          startedAt: expect.any(String),
          settledAt: null,
          hasTranscript: true,
          worktree: null
        }
      ]
    })
    expect(tasks[1]).toMatchObject({
      taskId: agy.taskId,
      title: FIXTURE_OBJECTIVE,
      executorKind: 'agy',
      attempts: [
        { dispatchId: agy.dispatchId, state: 'completed', hasTranscript: false, worktree: null }
      ]
    })
    expect(tasks[1].attempts[0].settledAt).not.toBeNull()
  })

  it('takes the executor of a Claude task from its route and its attempts from Orca', async () => {
    const h = setup()
    const subagent = seedClaudeTask(h, { target: 'claude_subagent' })
    const workflow = seedClaudeTask(h, { target: 'claude_workflow' })

    const { tasks } = await tasksOf(h)
    expect(tasks.map((task) => task.executorKind)).toEqual(['claude_subagent', 'claude_workflow'])
    expect(tasks[0].attempts).toEqual([
      {
        dispatchId: subagent.dispatchId,
        state: 'starting',
        startedAt: expect.any(String),
        settledAt: null,
        hasTranscript: false,
        worktree: null
      }
    ])
    expect(tasks[1].attempts[0].dispatchId).toBe(workflow.dispatchId)
  })

  it('treats a task with no route or a route kept with the primary as the primary session', async () => {
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

    const { tasks } = await tasksOf(h)
    expect(tasks.map((task) => [task.executorKind, task.attempts])).toEqual([
      ['claude_primary', []],
      ['claude_primary', []]
    ])
  })

  it('reports no transcript for a run directory outside the runs root', async () => {
    const h = setup()
    const codex = seedCodexAttempt(h, { runDirectory: 'elsewhere/run/ctx' })
    writeTranscript(codex.runDir, FIXTURE_START)

    const { tasks } = await tasksOf(h)
    expect(tasks[0].attempts[0].hasTranscript).toBe(false)
  })

  it('refuses a run the app does not know', async () => {
    const h = setup()
    await expect(tasksOf(h, 'run_unknown0001')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OrchestrationError && error.code === 'workbench_run_not_found'
    )
  })
})

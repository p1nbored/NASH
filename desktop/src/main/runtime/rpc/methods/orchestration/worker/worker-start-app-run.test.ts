// FIXTURE_ONLY: synthetic runs and tasks; no real terminal, worktree or network.
import { afterEach, describe, expect, it } from 'vitest'
import { APP_RUN_POLICY_ERROR_CODES } from '../../../../workflow-run/app-run-policy'
import {
  addAppTaskSpec,
  markRunAsAppRun
} from '../../../../workflow-run/app-run-policy.test-fixture'
import { createOrchestrationRpcHarness, type OrchestrationRpcState } from '../rpc-test-harness'

describe('orchestration.workerStart against app runs', () => {
  const h = createOrchestrationRpcHarness()
  afterEach(() => h.cleanup())

  function setupAppRun() {
    const state = h.setup()
    const runId = state.activeRunId as string
    markRunAsAppRun(state.db, { runId, paneKey: h.coordinatorPaneKey })
    const task = state.db.createTask({ spec: 'delegated work' })
    addAppTaskSpec(state.db, task.id, runId)
    return { ...state, runId, taskId: task.id }
  }

  const start = (state: Pick<OrchestrationRpcState, 'ctx'>, params: Record<string, unknown>) =>
    h.call('orchestration.workerStart', { from: 'term_coord', ...params }, state.ctx)

  it('refuses a start for an existing task with a hint to use task-start', async () => {
    const state = setupAppRun()

    await expect(start(state, { task: state.taskId })).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.useTaskStart,
      message: expect.stringContaining('task-start'),
      data: {
        effectsApplied: false,
        nextCommandArgs: ['orchestration', 'task-start', '--task', state.taskId]
      }
    })

    expect(state.db.getDispatchContext(state.taskId)).toBeUndefined()
  })

  it('refuses a start that would create a task from --spec, and creates none', async () => {
    const state = setupAppRun()
    const tasksBefore = state.db.listTasks().length

    await expect(start(state, { spec: 'a task the primary invented' })).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.useTaskStart
    })

    expect(state.db.listTasks()).toHaveLength(tasksBefore)
  })

  it('refuses a remote start the same way', async () => {
    const state = setupAppRun()

    await expect(start(state, { task: state.taskId, on: 'server_fixture' })).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.useTaskStart
    })
  })

  describe('a run without a workflow_runs row', () => {
    it('reaches the Orca task lookup, as before', async () => {
      const state = h.setup()

      await expect(start(state, { task: 'task_missing' })).rejects.toMatchObject({
        code: 'task_not_found'
      })
    })

    it('still fences a terminal that is not the run coordinator', async () => {
      const state = h.setup()

      await expect(
        h.call('orchestration.workerStart', { from: 'term_stranger', task: 'task_x' }, state.ctx)
      ).rejects.toMatchObject({
        code: expect.stringMatching(/consumer_fenced|stable_pane_required/)
      })
    })
  })
})

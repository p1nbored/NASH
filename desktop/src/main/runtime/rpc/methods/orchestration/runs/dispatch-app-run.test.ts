// FIXTURE_ONLY: synthetic runs and tasks; no real terminal or network.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_RUN_POLICY_ERROR_CODES } from '../../../../workflow-run/app-run-policy'
import {
  addAppTaskSpec,
  markRunAsAppRun
} from '../../../../workflow-run/app-run-policy.test-fixture'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'

const OTHER_PANE_KEY = 'tab_plain:cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('orchestration.dispatch against app runs', () => {
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

  it('refuses a dispatch with a hint to use task-start, and creates no dispatch', async () => {
    const state = setupAppRun()

    await expect(
      h.call('orchestration.dispatch', { task: state.taskId, to: 'term_worker' }, state.ctx)
    ).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.useTaskStart,
      message: expect.stringContaining('task-start'),
      data: {
        effectsApplied: false,
        nextCommandArgs: ['orchestration', 'task-start', '--task', state.taskId]
      }
    })

    expect(state.db.getDispatchContext(state.taskId)).toBeUndefined()
    expect(state.db.getTask(state.taskId)?.status).not.toBe('dispatched')
  })

  it('refuses a dry run too, so the primary is never shown a terminal-worker preamble', async () => {
    const state = setupAppRun()

    await expect(
      h.call('orchestration.dispatch', { task: state.taskId, dryRun: true }, state.ctx)
    ).rejects.toMatchObject({ code: APP_RUN_POLICY_ERROR_CODES.useTaskStart })
  })

  it('still answers task_not_found for an unknown task before the policy applies', async () => {
    const state = setupAppRun()

    await expect(
      h.call('orchestration.dispatch', { task: 'task_missing', to: 'term_worker' }, state.ctx)
    ).rejects.toMatchObject({ code: 'task_not_found' })
  })

  describe('a run without a workflow_runs row', () => {
    it('previews the preamble exactly as before', async () => {
      const state = h.setup()
      const task = state.db.createTask({ spec: 'plain work' })

      await expect(
        h.call('orchestration.dispatch', { task: task.id, dryRun: true }, state.ctx)
      ).resolves.toMatchObject({ dispatch: null, injected: false, dryRun: true })
    })

    it('is not affected by an app run in the same database', async () => {
      const state = setupAppRun()
      const plainRun = state.db.createRun({
        objective: 'Plain',
        coordinatorHandle: 'term_plain',
        coordinatorPaneKey: OTHER_PANE_KEY
      })
      vi.spyOn(state.runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
        handle === 'term_plain' ? OTHER_PANE_KEY : h.coordinatorPaneKey
      )
      const plainTask = state.db.createTask({ spec: 'plain work', runId: plainRun.id })

      await expect(
        h.call(
          'orchestration.dispatch',
          { task: plainTask.id, dryRun: true, run: plainRun.id, from: 'term_plain' },
          state.ctx
        )
      ).resolves.toMatchObject({ dryRun: true })
    })
  })
})

// FIXTURE_ONLY: synthetic runs, tasks and validation rows; no real terminal or network.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_RUN_POLICY_ERROR_CODES } from '../../../../workflow-run/app-run-policy'
import {
  addAppTaskSpec,
  addValidationRow,
  markRunAsAppRun
} from '../../../../workflow-run/app-run-policy.test-fixture'
import { readSchemaEntries } from '../../../../orchestration/db/autopilot-runtime.test-fixture'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'

const OTHER_PANE_KEY = 'tab_plain:cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('orchestration.taskUpdate against app runs', () => {
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

  const update = (
    state: ReturnType<typeof setupAppRun>,
    status: string,
    extra: Record<string, unknown> = {}
  ) => h.call('orchestration.taskUpdate', { id: state.taskId, status, ...extra }, state.ctx)

  it('refuses completed without a passing validation and leaves the task untouched', async () => {
    const state = setupAppRun()
    const before = state.db.getTask(state.taskId)

    await expect(update(state, 'completed')).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.validationRequired,
      data: { effectsApplied: false }
    })

    expect(state.db.getTask(state.taskId)).toEqual(before)
  })

  it('refuses completed when the only validation failed', async () => {
    const state = setupAppRun()
    addValidationRow(state.db, state.taskId, 'fail')

    await expect(update(state, 'completed')).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.validationRequired
    })
  })

  it('refuses dispatched and points at task-start', async () => {
    const state = setupAppRun()
    const before = state.db.getTask(state.taskId)

    await expect(update(state, 'dispatched')).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.taskStatusRefused,
      data: { nextCommandArgs: ['orchestration', 'task-start', '--task', state.taskId] }
    })

    expect(state.db.getTask(state.taskId)).toEqual(before)
  })

  it('completes the task once a validator recorded a pass', async () => {
    const state = setupAppRun()
    addValidationRow(state.db, state.taskId, 'pass')

    await expect(update(state, 'completed', { result: 'validated' })).resolves.toMatchObject({
      task: { id: state.taskId, status: 'completed' }
    })
  })

  it('still lets the primary mark an app task failed', async () => {
    const state = setupAppRun()

    await expect(update(state, 'failed')).resolves.toMatchObject({
      task: { id: state.taskId, status: 'failed' }
    })
  })

  describe('a run without a workflow_runs row', () => {
    it('completes a task with no validation record, as before, and adds no table', async () => {
      const state = h.setup()
      const task = state.db.createTask({ spec: 'plain work' })
      const entriesBefore = readSchemaEntries(state.db.db)

      await expect(
        h.call('orchestration.taskUpdate', { id: task.id, status: 'completed' }, state.ctx)
      ).resolves.toMatchObject({ task: { id: task.id, status: 'completed' } })

      expect(readSchemaEntries(state.db.db)).toEqual(entriesBefore)
    })

    it('leaves dispatched to Orca, which answers with its own refusal', async () => {
      const state = h.setup()
      const task = state.db.createTask({ spec: 'plain work' })

      await expect(
        h.call('orchestration.taskUpdate', { id: task.id, status: 'dispatched' }, state.ctx)
      ).rejects.toMatchObject({ code: 'task_not_startable' })
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
          'orchestration.taskUpdate',
          {
            id: plainTask.id,
            status: 'completed',
            run: plainRun.id,
            callerTerminalHandle: 'term_plain'
          },
          state.ctx
        )
      ).resolves.toMatchObject({ task: { id: plainTask.id, status: 'completed' } })
    })
  })
})

// FIXTURE_ONLY: synthetic runs and tasks; no real terminal or network.
import { afterEach, describe, expect, it } from 'vitest'
import { readSchemaEntries } from '../../../../orchestration/db/autopilot-runtime.test-fixture'
import { APP_RUN_POLICY_ERROR_CODES } from '../../../../workflow-run/app-run-policy'
import { markRunAsAppRun } from '../../../../workflow-run/app-run-policy.test-fixture'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'

describe('orchestration.reset against app runs', () => {
  const h = createOrchestrationRpcHarness()
  afterEach(() => h.cleanup())

  const scopes = [{ all: true }, { tasks: true }, { messages: true }] as const

  it.each(scopes)(
    'is refused for %o while an app run is active, and deletes nothing',
    async (scope) => {
      const state = h.setup()
      const runId = state.activeRunId as string
      markRunAsAppRun(state.db, { runId, paneKey: h.coordinatorPaneKey })
      const task = state.db.createTask({ spec: 'delegated work' })

      await expect(h.call('orchestration.reset', { ...scope }, state.ctx)).rejects.toMatchObject({
        code: APP_RUN_POLICY_ERROR_CODES.resetRefused,
        data: { effectsApplied: false, runIds: [runId] }
      })

      expect(state.db.getTask(task.id)).toBeDefined()
      expect(state.db.getRun(runId)).toBeDefined()
    }
  )

  it('is allowed again once the app run reached a terminal status', async () => {
    const state = h.setup()
    const runId = state.activeRunId as string
    markRunAsAppRun(state.db, { runId, status: 'completed', primary: 'none' })
    const task = state.db.createTask({ spec: 'finished work' })

    await expect(h.call('orchestration.reset', { all: true }, state.ctx)).resolves.toEqual({
      reset: 'all'
    })

    expect(state.db.getTask(task.id)).toBeUndefined()
  })

  describe('a database with no open app run', () => {
    it('resets exactly as before and creates no table', async () => {
      const state = h.setup()
      const task = state.db.createTask({ spec: 'plain work' })
      const entriesBefore = readSchemaEntries(state.db.db)

      await expect(h.call('orchestration.reset', { tasks: true }, state.ctx)).resolves.toEqual({
        reset: 'tasks'
      })

      expect(state.db.getTask(task.id)).toBeUndefined()
      expect(readSchemaEntries(state.db.db)).toEqual(entriesBefore)
    })
  })
})

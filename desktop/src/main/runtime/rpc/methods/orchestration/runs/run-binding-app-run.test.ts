// FIXTURE_ONLY: synthetic runs and panes; no real terminal or network.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_RUN_POLICY_ERROR_CODES } from '../../../../workflow-run/app-run-policy'
import {
  OTHER_PANE_KEY,
  PRIMARY_PANE_KEY,
  markRunAsAppRun
} from '../../../../workflow-run/app-run-policy.test-fixture'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'

const THIRD_PANE_KEY = 'tab_third:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PANES: Record<string, string> = {
  term_primary: PRIMARY_PANE_KEY,
  term_other: OTHER_PANE_KEY,
  term_third: THIRD_PANE_KEY
}

type RunReceipt = { run: { id: string; consumer_generation: number } }

describe('run-create and run-use against app runs', () => {
  const h = createOrchestrationRpcHarness()
  afterEach(() => h.cleanup())

  async function setupAppRun() {
    const state = h.setup(false)
    vi.spyOn(state.runtime, 'getTerminalPaneKey').mockImplementation(
      (handle) => PANES[handle] ?? null
    )
    const call = (name: string, params: Record<string, unknown>) => h.call(name, params, state.ctx)
    const created = (await call('orchestration.runCreate', {
      objective: 'App run',
      from: 'term_primary'
    })) as RunReceipt
    markRunAsAppRun(state.db, { runId: created.run.id, paneKey: PRIMARY_PANE_KEY })
    state.db.createTask({ spec: 'Pending coordination work', runId: created.run.id })
    return { ...state, call, appRun: created.run }
  }

  const current = async (
    state: Awaited<ReturnType<typeof setupAppRun>>,
    from: string
  ): Promise<{ id: string } | null> =>
    ((await state.call('orchestration.runCurrent', { from })) as { run: { id: string } | null }).run

  it('refuses run-create from the primary pane and keeps it on its run', async () => {
    const state = await setupAppRun()

    await expect(
      state.call('orchestration.runCreate', { objective: 'Second', from: 'term_primary' })
    ).rejects.toMatchObject({
      code: APP_RUN_POLICY_ERROR_CODES.primaryFenced,
      data: { effectsApplied: false }
    })

    expect(state.db.listRuns().runs.filter((run) => run.legacy === 0)).toHaveLength(1)
    expect((await current(state, 'term_primary'))?.id).toBe(state.appRun.id)
  })

  it('refuses run-use of another run from the primary pane and changes no binding', async () => {
    const state = await setupAppRun()
    const plain = (await state.call('orchestration.runCreate', {
      objective: 'Plain',
      from: 'term_other'
    })) as RunReceipt

    await expect(
      state.call('orchestration.runUse', { id: plain.run.id, from: 'term_primary' })
    ).rejects.toMatchObject({ code: APP_RUN_POLICY_ERROR_CODES.primaryFenced })

    expect((await current(state, 'term_primary'))?.id).toBe(state.appRun.id)
    expect((await current(state, 'term_other'))?.id).toBe(plain.run.id)
  })

  it('refuses run-use of the app run from any other pane and keeps the primary bound', async () => {
    const state = await setupAppRun()

    for (const from of ['term_other', 'term_third']) {
      await expect(
        state.call('orchestration.runUse', { id: state.appRun.id, from })
      ).rejects.toMatchObject({ code: APP_RUN_POLICY_ERROR_CODES.primaryFenced })
    }

    expect((await current(state, 'term_primary'))?.id).toBe(state.appRun.id)
    expect(state.db.getRun(state.appRun.id)?.consumer_generation).toBe(
      state.appRun.consumer_generation
    )
  })

  it('lets the primary use its own run again', async () => {
    const state = await setupAppRun()

    await expect(
      state.call('orchestration.runUse', { id: state.appRun.id, from: 'term_primary' })
    ).resolves.toMatchObject({ run: { id: state.appRun.id } })
  })

  describe('a terminal that is not an app primary', () => {
    it('creates and rebinds plain runs as before, beside an app run', async () => {
      const state = await setupAppRun()
      const plain = (await state.call('orchestration.runCreate', {
        objective: 'Plain',
        from: 'term_other'
      })) as RunReceipt

      await expect(
        state.call('orchestration.runUse', { id: plain.run.id, from: 'term_third' })
      ).resolves.toMatchObject({ run: { id: plain.run.id, consumer_generation: 2 } })
      expect((await current(state, 'term_third'))?.id).toBe(plain.run.id)
    })

    it('still answers run_not_found for an unknown run id', async () => {
      const state = await setupAppRun()

      await expect(
        state.call('orchestration.runUse', { id: 'run_does_not_exist', from: 'term_other' })
      ).rejects.toMatchObject({ code: 'run_not_found' })
    })
  })

  describe('a database that never recorded an app run', () => {
    it('binds, creates and rebinds exactly as before', async () => {
      const state = h.setup(false)
      vi.spyOn(state.runtime, 'getTerminalPaneKey').mockImplementation(
        (handle) => PANES[handle] ?? null
      )
      const call = (name: string, params: Record<string, unknown>) =>
        h.call(name, params, state.ctx)

      const created = (await call('orchestration.runCreate', {
        objective: 'Plain',
        from: 'term_primary'
      })) as RunReceipt
      const again = (await call('orchestration.runCreate', {
        objective: 'Plain again',
        from: 'term_primary'
      })) as RunReceipt
      const moved = (await call('orchestration.runUse', {
        id: created.run.id,
        from: 'term_other'
      })) as RunReceipt

      expect(again.run.id).not.toBe(created.run.id)
      expect(moved.run.id).toBe(created.run.id)
    })
  })
})

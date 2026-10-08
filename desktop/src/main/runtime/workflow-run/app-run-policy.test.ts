// FIXTURE_ONLY: synthetic runs, panes and records; no real terminal, process or network.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCoordinatorKey } from '../orchestration/orchestration-caller-identity'
import {
  readSchemaEntries,
  readUserVersion
} from '../orchestration/db/autopilot-runtime.test-fixture'
import { ensureAutopilotRuntimeSchema } from '../orchestration/db/autopilot-runtime-schema'
import {
  APP_RUN_POLICY_ERROR_CODES,
  assertAppRunPrimaryMayCreateRun,
  assertAppRunTaskUpdateAllowed,
  assertAppRunUseAllowed,
  assertAppRunUsesTaskStart,
  assertNoOpenAppRunBeforeReset
} from './app-run-policy'
import type { AppRunReaders } from './app-run-readers'
import {
  OTHER_PANE_KEY,
  PRIMARY_PANE_KEY,
  PRIMARY_PANE_KEY_REMINTED,
  addAppTaskSpec,
  addValidationRow,
  markRunAsAppRun
} from './app-run-policy.test-fixture'

const CODES = APP_RUN_POLICY_ERROR_CODES

function caller(paneKey: string | null): OrchestrationCoordinatorKey {
  return { terminalHandle: paneKey ? 'term_caller' : null, paneKey, orcaSessionId: null }
}

function listedRunIds(data: unknown): readonly unknown[] {
  if (typeof data === 'object' && data !== null && 'runIds' in data && Array.isArray(data.runIds)) {
    return data.runIds
  }
  return []
}

function refusal(operation: () => void): { code: string; data: unknown } | null {
  try {
    operation()
    return null
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return { code: error.code, data: error.data }
    }
    throw error
  }
}

describe('app-run policy', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })
  afterEach(() => db.close())

  function orcaRun(paneKey: string = PRIMARY_PANE_KEY): string {
    return db.createRun({
      objective: 'Policy',
      coordinatorHandle: 'term_primary',
      coordinatorPaneKey: paneKey
    }).id
  }

  function appTask(runId: string): string {
    const task = db.createTask({ spec: 'work', runId })
    addAppTaskSpec(db, task.id, runId)
    return task.id
  }

  describe('a database without the autopilot tables', () => {
    it('lets every guard pass and creates nothing', () => {
      const runId = orcaRun()
      const task = db.createTask({ spec: 'plain', runId })
      const entriesBefore = readSchemaEntries(db.db)
      const versionBefore = readUserVersion(db.db)

      const outcomes = [
        refusal(() =>
          assertAppRunTaskUpdateAllowed(db, { runId, taskId: task.id, status: 'completed' })
        ),
        refusal(() =>
          assertAppRunTaskUpdateAllowed(db, { runId, taskId: task.id, status: 'dispatched' })
        ),
        refusal(() => assertAppRunUsesTaskStart(db, { runId, command: 'worker-start' })),
        refusal(() =>
          assertAppRunUsesTaskStart(db, { runId, command: 'dispatch', taskId: task.id })
        ),
        refusal(() => assertAppRunPrimaryMayCreateRun(db, caller(PRIMARY_PANE_KEY))),
        refusal(() => assertAppRunUseAllowed(db, caller(OTHER_PANE_KEY), runId)),
        refusal(() => assertNoOpenAppRunBeforeReset(db))
      ]

      expect(outcomes).toEqual(outcomes.map(() => null))
      expect(readSchemaEntries(db.db)).toEqual(entriesBefore)
      expect(readUserVersion(db.db)).toBe(versionBefore)
    })
  })

  describe('a run without a workflow_runs row', () => {
    it('is unchanged even when the autopilot tables and another app run exist', () => {
      const appRunId = orcaRun(PRIMARY_PANE_KEY)
      markRunAsAppRun(db, { runId: appRunId })
      const plainRunId = orcaRun(OTHER_PANE_KEY)
      const task = db.createTask({ spec: 'plain', runId: plainRunId })

      for (const status of ['completed', 'dispatched', 'failed', 'blocked'] as const) {
        expect(
          refusal(() =>
            assertAppRunTaskUpdateAllowed(db, { runId: plainRunId, taskId: task.id, status })
          )
        ).toBeNull()
      }
      expect(
        refusal(() => assertAppRunUsesTaskStart(db, { runId: plainRunId, command: 'worker-start' }))
      ).toBeNull()
      expect(
        refusal(() =>
          assertAppRunUsesTaskStart(db, { runId: plainRunId, command: 'dispatch', taskId: task.id })
        )
      ).toBeNull()
      expect(refusal(() => assertAppRunPrimaryMayCreateRun(db, caller(OTHER_PANE_KEY)))).toBeNull()
      expect(
        refusal(() => assertAppRunUseAllowed(db, caller(OTHER_PANE_KEY), plainRunId))
      ).toBeNull()
    })

    it('leaves the family alone when only the schema exists', () => {
      ensureAutopilotRuntimeSchema(db.db)
      const runId = orcaRun()
      const task = db.createTask({ spec: 'plain', runId })

      expect(
        refusal(() =>
          assertAppRunTaskUpdateAllowed(db, { runId, taskId: task.id, status: 'completed' })
        )
      ).toBeNull()
      expect(refusal(() => assertNoOpenAppRunBeforeReset(db))).toBeNull()
    })
  })

  describe('task updates in an app run', () => {
    let runId: string
    let taskId: string

    beforeEach(() => {
      runId = orcaRun()
      markRunAsAppRun(db, { runId })
      taskId = appTask(runId)
    })

    const update = (
      status: 'completed' | 'dispatched' | 'failed' | 'blocked' | 'ready' | 'pending'
    ) => refusal(() => assertAppRunTaskUpdateAllowed(db, { runId, taskId, status }))

    it('refuses dispatched and points at task-start', () => {
      const refused = update('dispatched')

      expect(refused?.code).toBe(CODES.taskStatusRefused)
      expect(refused?.data).toMatchObject({
        effectsApplied: false,
        nextCommandArgs: ['orchestration', 'task-start', '--task', taskId]
      })
    })

    it('refuses completed while the task has no validation record', () => {
      expect(update('completed')).toMatchObject({
        code: CODES.validationRequired,
        data: { effectsApplied: false }
      })
    })

    it.each(['pending', 'fail', 'inconclusive'] as const)(
      'refuses completed when the only record is %s',
      (verdict) => {
        addValidationRow(db, taskId, verdict)

        expect(update('completed')?.code).toBe(CODES.validationRequired)
      }
    )

    it('refuses completed for a waived inconclusive record: only a pass completes', () => {
      addValidationRow(db, taskId, 'inconclusive', 'desktop_user')

      expect(update('completed')?.code).toBe(CODES.validationRequired)
    })

    it('allows completed once a validator recorded a pass', () => {
      addValidationRow(db, taskId, 'pass')

      expect(update('completed')).toBeNull()
    })

    it('does not count a pass recorded for another task', () => {
      const otherTask = appTask(runId)
      addValidationRow(db, otherTask, 'pass')

      expect(update('completed')?.code).toBe(CODES.validationRequired)
    })

    it('does not count a pass left behind after Orca deleted the task', () => {
      addValidationRow(db, taskId, 'pass')
      db.resetTasks()

      expect(update('completed')?.code).toBe(CODES.validationRequired)
    })

    it.each(['failed', 'blocked', 'ready', 'pending'] as const)(
      'leaves %s to Orca, as before',
      (status) => {
        expect(update(status)).toBeNull()
      }
    )

    it('still guards a completed app run, where the row stays the marker', () => {
      const finished = orcaRun(OTHER_PANE_KEY)
      markRunAsAppRun(db, { runId: finished, status: 'completed', primary: 'none' })
      const task = appTask(finished)

      expect(
        refusal(() =>
          assertAppRunTaskUpdateAllowed(db, { runId: finished, taskId: task, status: 'completed' })
        )?.code
      ).toBe(CODES.validationRequired)
    })
  })

  describe('worker-start and dispatch in an app run', () => {
    it('refuses both with a hint to use task-start', () => {
      const runId = orcaRun()
      markRunAsAppRun(db, { runId })
      const taskId = appTask(runId)

      const start = refusal(() =>
        assertAppRunUsesTaskStart(db, { runId, command: 'worker-start', taskId })
      )
      const dispatch = refusal(() =>
        assertAppRunUsesTaskStart(db, { runId, command: 'dispatch', taskId })
      )

      for (const refused of [start, dispatch]) {
        expect(refused?.code).toBe(CODES.useTaskStart)
        expect(refused?.data).toMatchObject({
          effectsApplied: false,
          nextCommandArgs: ['orchestration', 'task-start', '--task', taskId]
        })
      }
    })

    it('names no task in the hint when the command carried none', () => {
      const runId = orcaRun()
      markRunAsAppRun(db, { runId })

      const refused = refusal(() =>
        assertAppRunUsesTaskStart(db, { runId, command: 'worker-start' })
      )

      expect(refused?.code).toBe(CODES.useTaskStart)
      expect(refused?.data).not.toHaveProperty('nextCommandArgs')
      expect(refused?.data).toMatchObject({ effectsApplied: false })
    })
  })

  describe('run binding', () => {
    let appRunId: string
    let plainRunId: string

    beforeEach(() => {
      appRunId = orcaRun(PRIMARY_PANE_KEY)
      markRunAsAppRun(db, { runId: appRunId })
      plainRunId = orcaRun(OTHER_PANE_KEY)
    })

    it('refuses run-create from the primary pane', () => {
      const refused = refusal(() => assertAppRunPrimaryMayCreateRun(db, caller(PRIMARY_PANE_KEY)))

      expect(refused).toMatchObject({
        code: CODES.primaryFenced,
        data: { effectsApplied: false }
      })
    })

    it('recognizes the primary pane after its tab half was reminted', () => {
      expect(
        refusal(() => assertAppRunPrimaryMayCreateRun(db, caller(PRIMARY_PANE_KEY_REMINTED)))?.code
      ).toBe(CODES.primaryFenced)
    })

    it('recognizes a primary by the owner row alone, when Orca binds another pane', () => {
      const split = orcaRun('tab_orca:cccccccc-cccc-4ccc-8ccc-cccccccccccc')
      markRunAsAppRun(db, {
        runId: split,
        paneKey: 'tab_owner:dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      })

      expect(
        refusal(() =>
          assertAppRunPrimaryMayCreateRun(
            db,
            caller('tab_owner:dddddddd-dddd-4ddd-8ddd-dddddddddddd')
          )
        )?.code
      ).toBe(CODES.primaryFenced)
    })

    it('matches the owner pane by leaf id too, so a reminted tab half still counts', () => {
      const split = orcaRun('tab_orca:cccccccc-cccc-4ccc-8ccc-cccccccccccc')
      markRunAsAppRun(db, {
        runId: split,
        paneKey: 'tab_owner:dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      })

      expect(
        refusal(() =>
          assertAppRunPrimaryMayCreateRun(
            db,
            caller('tab_moved:dddddddd-dddd-4ddd-8ddd-dddddddddddd')
          )
        )?.code
      ).toBe(CODES.primaryFenced)
    })

    it('recognizes a primary still starting by Orca binding alone', () => {
      const launching = orcaRun('tab_launch:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      markRunAsAppRun(db, { runId: launching, status: 'launching', primary: 'starting' })

      expect(
        refusal(() =>
          assertAppRunPrimaryMayCreateRun(
            db,
            caller('tab_launch:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
          )
        )?.code
      ).toBe(CODES.primaryFenced)
    })

    it('lets a pane that is no primary create a Run', () => {
      expect(refusal(() => assertAppRunPrimaryMayCreateRun(db, caller(OTHER_PANE_KEY)))).toBeNull()
      expect(
        refusal(() =>
          assertAppRunPrimaryMayCreateRun(
            db,
            caller('tab_new:ffffffff-ffff-4fff-8fff-ffffffffffff')
          )
        )
      ).toBeNull()
    })

    it('lets the primary use its own run again', () => {
      expect(
        refusal(() => assertAppRunUseAllowed(db, caller(PRIMARY_PANE_KEY), appRunId))
      ).toBeNull()
    })

    it('refuses the primary using a plain run or another app run', () => {
      const another = orcaRun('tab_second:99999999-9999-4999-8999-999999999999')
      markRunAsAppRun(db, {
        runId: another,
        paneKey: 'tab_second:99999999-9999-4999-8999-999999999999'
      })

      for (const target of [plainRunId, another]) {
        expect(
          refusal(() => assertAppRunUseAllowed(db, caller(PRIMARY_PANE_KEY), target))
        ).toMatchObject({ code: CODES.primaryFenced, data: { effectsApplied: false } })
      }
    })

    it('refuses any other pane using an app run, including a pane with no key', () => {
      expect(
        refusal(() => assertAppRunUseAllowed(db, caller(OTHER_PANE_KEY), appRunId))?.code
      ).toBe(CODES.primaryFenced)
      expect(refusal(() => assertAppRunUseAllowed(db, caller(null), appRunId))?.code).toBe(
        CODES.primaryFenced
      )
    })

    it('lets a plain pane use a plain run and an unknown run id', () => {
      expect(
        refusal(() => assertAppRunUseAllowed(db, caller(OTHER_PANE_KEY), plainRunId))
      ).toBeNull()
      expect(
        refusal(() => assertAppRunUseAllowed(db, caller(OTHER_PANE_KEY), 'run_unknown'))
      ).toBeNull()
    })

    it('keeps an app run fenced after its primary exited', () => {
      const ended = orcaRun('tab_ended:12121212-1212-4212-8212-121212121212')
      markRunAsAppRun(db, {
        runId: ended,
        primary: 'exited',
        paneKey: 'tab_ended:12121212-1212-4212-8212-121212121212'
      })

      expect(refusal(() => assertAppRunUseAllowed(db, caller(OTHER_PANE_KEY), ended))?.code).toBe(
        CODES.primaryFenced
      )
    })
  })

  describe('reset', () => {
    it.each(['launching', 'active', 'completing', 'unverifiable'] as const)(
      'is refused while an app run is %s',
      (status) => {
        const runId = orcaRun()
        markRunAsAppRun(db, {
          runId,
          status,
          primary: status === 'launching' ? 'starting' : 'running'
        })

        expect(refusal(() => assertNoOpenAppRunBeforeReset(db))).toMatchObject({
          code: CODES.resetRefused,
          data: { effectsApplied: false, runIds: [runId] }
        })
      }
    )

    it.each(['completed', 'failed', 'canceled'] as const)(
      'is allowed when the only app run is %s',
      (status) => {
        const runId = orcaRun()
        markRunAsAppRun(db, { runId, status, primary: 'none' })

        expect(refusal(() => assertNoOpenAppRunBeforeReset(db))).toBeNull()
      }
    )

    it('is allowed with no app run at all', () => {
      orcaRun()

      expect(refusal(() => assertNoOpenAppRunBeforeReset(db))).toBeNull()
    })

    it('bounds the run ids it lists', () => {
      for (let index = 0; index < 8; index += 1) {
        const runId = orcaRun(`tab_many${index}:0000000${index}-0000-4000-8000-000000000000`)
        markRunAsAppRun(db, { runId, primary: 'none' })
      }

      const refused = refusal(() => assertNoOpenAppRunBeforeReset(db))

      expect(listedRunIds(refused?.data)).toHaveLength(5)
    })
  })

  describe('injected readers', () => {
    it('reads validations through the port it is given', () => {
      const runId = orcaRun()
      const readers: AppRunReaders = {
        findAppRun: (id) => (id === runId ? { runId, status: 'active' } : null),
        listOpenAppRuns: () => [],
        listLivePrimaryPanes: () => [],
        hasPassingValidation: (taskId) => taskId === 'task_validated'
      }

      expect(
        refusal(() =>
          assertAppRunTaskUpdateAllowed(
            db,
            { runId, taskId: 'task_validated', status: 'completed' },
            readers
          )
        )
      ).toBeNull()
      expect(
        refusal(() =>
          assertAppRunTaskUpdateAllowed(
            db,
            { runId, taskId: 'task_unvalidated', status: 'completed' },
            readers
          )
        )?.code
      ).toBe(CODES.validationRequired)
    })
  })
})

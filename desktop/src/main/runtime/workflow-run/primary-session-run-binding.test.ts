import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { releaseEndedPrimaryBinding } from './primary-session-run-binding'
import { FIXTURE_HANDLE, FIXTURE_PANE, seedPrimaryRun } from './primary-session.test-fixture'

describe('releasing the Orca run binding of an ended primary', () => {
  let db: OrchestrationDb
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })
  afterEach(() => db.close())

  function seedBound() {
    const { run, owner } = seedPrimaryRun(db)
    db.bindRun({
      runId: run.runId,
      coordinatorHandle: FIXTURE_HANDLE,
      coordinatorPaneKey: FIXTURE_PANE
    })
    return { run, owner: owner! }
  }

  function exit(ownerId: string) {
    return getPrimarySessionStore(db).transition({
      ownerId,
      from: 'running',
      to: 'exited',
      reason: 'primary_exited',
      timestamp: fixtureTime(20)
    })
  }

  it("clears the binding once the primary exited, so B4's fence frees that pane", () => {
    const { run, owner } = seedBound()
    const exited = exit(owner.ownerId)
    expect(releaseEndedPrimaryBinding(db, exited)).toBe(true)
    expect(db.getRun(run.runId)).toMatchObject({
      coordinator_handle: null,
      coordinator_pane_key: null
    })
    expect(db.runsBoundToPane(FIXTURE_PANE)).toEqual([])
    expect(releaseEndedPrimaryBinding(db, exited)).toBe(false)
  })

  it('leaves a live primary bound', () => {
    const { run, owner } = seedBound()
    expect(releaseEndedPrimaryBinding(db, owner)).toBe(false)
    expect(db.getRun(run.runId)?.coordinator_pane_key).toBe(FIXTURE_PANE)
  })

  it('leaves a binding that already names another pane', () => {
    const { run, owner } = seedBound()
    const otherPane = 'tab_other:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    db.bindRun({ runId: run.runId, coordinatorHandle: 'term_other', coordinatorPaneKey: otherPane })
    expect(releaseEndedPrimaryBinding(db, exit(owner.ownerId))).toBe(false)
    expect(db.getRun(run.runId)?.coordinator_pane_key).toBe(otherPane)
  })
})

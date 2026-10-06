import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import { getTaskClassificationStore } from '../orchestration/db/task-classification-store'
import { transportHeldUntilReleased } from '../workbench-routing/clef-scripted-transport.test-fixture'
import { proposeFixtureTask } from './classification-db.test-fixture'
import { createClassifierHarness, type ClassifierHarness } from './classification-deps.test-fixture'
import { createTaskClassificationRuntime } from './classification-runtime'

// FIXTURE_ONLY: a held call stands in for a crash between the billed attempt and its record.
describe('classification recovery at startup', () => {
  let harness: ClassifierHarness | null = null

  beforeEach(() => setClefCallCircuit(null))
  afterEach(() => {
    harness?.db.owner.close()
    harness = null
    setClefCallCircuit(null)
  })

  function runtimeFor(h: ClassifierHarness, transport = h.deps.transport) {
    return createTaskClassificationRuntime({
      owner: h.db.owner,
      ledger: h.ledger,
      credentials: h.deps.credentials,
      verifiedProfile: h.deps.verifiedProfile,
      transport,
      routing: h.deps.routing,
      clock: h.deps.clock
    })
  }

  it('closes the open reservation as spent and records the interrupted attempt once', async () => {
    const held = transportHeldUntilReleased()
    harness = createClassifierHarness({ transport: held.transport })
    const task = proposeFixtureTask(harness.db)
    void runtimeFor(harness).classify(task.taskId)
    await held.inFlight
    // Why a second runtime: after a crash, the restarted app owns none of the old in-flight calls.
    const restarted = runtimeFor(harness)
    expect(restarted.recoverInterrupted()).toEqual({
      releasedReservations: 1,
      interruptedClassifications: 1
    })
    const store = getTaskClassificationStore(harness.db.owner)
    const recorded = store.latestForTask(task.taskId)
    expect(recorded).toMatchObject({ outcome: 'blocked', detail: 'interrupted', attempt: 1 })
    const spend = harness.db.owner.db
      .prepare('SELECT reservation_id, state FROM workbench_clef_spend')
      .get()
    expect(spend).toEqual({ reservation_id: recorded?.spendReservationId, state: 'released' })
    expect(restarted.recoverInterrupted()).toEqual({
      releasedReservations: 0,
      interruptedClassifications: 0
    })
    expect(harness.spendStore.countAttemptsForSubject(task.taskId)).toBe(1)
  })

  it('finds nothing to recover after a finished classification', async () => {
    harness = createClassifierHarness()
    const runtime = runtimeFor(harness)
    const task = proposeFixtureTask(harness.db)
    await runtime.classify(task.taskId).settled
    expect(runtime.recoverInterrupted()).toEqual({
      releasedReservations: 0,
      interruptedClassifications: 0
    })
  })
})

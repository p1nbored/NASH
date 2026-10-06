import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getClefCallCircuit, setClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import { createClefCallCircuit } from '../../clef/clef-call-circuit'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import { transportResponding } from '../workbench-routing/clef-scripted-transport.test-fixture'
import {
  FIXTURE_TASK_OBJECTIVE,
  proposeFixtureTask,
  type ClassificationDbHarness
} from './classification-db.test-fixture'
import {
  FIXTURE_CLASSIFY_NOW_MS,
  createClassifierHarness,
  fixtureRouting,
  type ClassifierHarness,
  type ClassifierHarnessOptions
} from './classification-deps.test-fixture'
import { loadClassificationSubject } from './classification-subject'
import { createTaskClassifier } from './task-classifier'

// FIXTURE_ONLY: synthetic TaskSpecs and scripted Clef answers; no network.
const NEVER_ABORTED = new AbortController().signal

function spendRows(db: ClassificationDbHarness): unknown {
  return db.owner.db.prepare('SELECT count(*) AS n FROM workbench_clef_spend').get()?.n
}

describe('TaskSpec classification gates: nothing is sent or spent when a gate refuses', () => {
  let harness: ClassifierHarness | null = null

  beforeEach(() => setClefCallCircuit(null))
  afterEach(() => {
    harness?.db.owner.close()
    harness = null
    setClefCallCircuit(null)
  })

  async function classify(options: ClassifierHarnessOptions = {}, objective?: string) {
    harness = createClassifierHarness(options)
    const task = proposeFixtureTask(harness.db, objective)
    const subject = loadClassificationSubject(harness.db.owner, task.taskId)
    const result = await createTaskClassifier(harness.deps).classify(subject, NEVER_ABORTED)
    return { result, h: harness, task }
  }

  it('G0: no verified profile blocks with no transport call and no spend', async () => {
    const { result, h } = await classify({ profile: null })
    expect(result.classification).toMatchObject({
      outcome: 'blocked',
      detail: 'contract_unverified'
    })
    expect(h.transport.calls()).toBe(0)
    expect(spendRows(h.db)).toBe(0)
  })

  it('G0: no spend cap gates the call; a configured classifier calls Clef (D-022)', async () => {
    const { result, h } = await classify()
    expect(result.classification.outcome).toBe('classified')
    expect(h.transport.calls()).toBe(1)
  })

  it('G0: missing credentials block before any call', async () => {
    harness = createClassifierHarness()
    harness.credentials.setStatus({
      tokenPresent: false,
      accountPresent: false,
      protection: 'absent'
    })
    const task = proposeFixtureTask(harness.db)
    const subject = loadClassificationSubject(harness.db.owner, task.taskId)
    const result = await createTaskClassifier(harness.deps).classify(subject, NEVER_ABORTED)
    expect(result.classification).toMatchObject({ outcome: 'blocked', detail: 'not_configured' })
    expect(harness.transport.calls()).toBe(0)
  })

  it('refuses a table of another taxonomy before the call and never falls back to the bundled one', async () => {
    const { result, h, task } = await classify({ routing: fixtureRouting('taxonomy_mismatch') })
    expect(result.classification).toMatchObject({
      outcome: 'blocked',
      detail: 'routing_table_taxonomy_mismatch'
    })
    expect(result.classification.answers).toMatchObject({
      blocker: { reason: 'routing_table_unavailable', detail: 'routing_table_taxonomy_mismatch' }
    })
    expect(h.transport.calls()).toBe(0)
    expect(spendRows(h.db)).toBe(0)
    expect(h.routing.lookups()).toBe(0)
    expect(getTaskRouteStore(h.db.owner).latestForTask(task.taskId)).toBeNull()
  })

  it('refuses when no table is installed', async () => {
    const { result, h } = await classify({ routing: fixtureRouting('not_installed') })
    expect(result.classification).toMatchObject({ detail: 'routing_table_not_installed' })
    expect(h.transport.calls()).toBe(0)
  })

  it('records a table refusal at lookup time with no route and no substitute', async () => {
    const installed = fixtureRouting('installed')
    const mismatched = fixtureRouting('taxonomy_mismatch')
    const routing = {
      port: { activeTable: installed.port.activeTable, resolveRoute: mismatched.port.resolveRoute },
      lookups: mismatched.lookups
    }
    const { result, h, task } = await classify({ routing })
    expect(result.classification).toMatchObject({ outcome: 'classified', needsDelegation: true })
    expect(result.route).toEqual({ kind: 'refused', reason: 'routing_table_taxonomy_mismatch' })
    expect(getTaskRouteStore(h.db.owner).latestForTask(task.taskId)).toBeNull()
  })

  it('G1: a path in the TaskSpec prose blocks the data boundary with no call', async () => {
    const { result, h } = await classify({}, 'Read C:\\Users\\fixture\\notes.txt and summarize it.')
    expect(result.classification).toMatchObject({
      outcome: 'blocked',
      detail: 'data_boundary_forbids'
    })
    expect(h.transport.calls()).toBe(0)
  })

  it('G1: prose outside the Latin script is no longer blocked; Clef is called (D-027)', async () => {
    const { result, h } = await classify({}, '给队列视图添加一个重试按钮。')
    expect(result.classification.detail).not.toBe('non_english_objective')
    expect(h.transport.calls()).toBe(1)
  })

  it('an open call circuit blocks with no call', async () => {
    harness = createClassifierHarness()
    setClefCallCircuit(createClefCallCircuit({ now: () => FIXTURE_CLASSIFY_NOW_MS }))
    for (let count = 0; count < 3; count += 1) {
      getClefCallCircuit().record('transient_exhausted', harness.credentials.generation())
    }
    const task = proposeFixtureTask(harness.db)
    const subject = loadClassificationSubject(harness.db.owner, task.taskId)
    const result = await createTaskClassifier(harness.deps).classify(subject, NEVER_ABORTED)
    expect(result.classification.outcome).toBe('blocked')
    expect(harness.transport.calls()).toBe(0)
  })

  it('reuses a classified answer for the same TaskSpec text with no call and a fresh route lookup', async () => {
    harness = createClassifierHarness()
    const classifier = createTaskClassifier(harness.deps)
    const first = proposeFixtureTask(harness.db, FIXTURE_TASK_OBJECTIVE)
    const second = proposeFixtureTask(harness.db, FIXTURE_TASK_OBJECTIVE)
    const original = await classifier.classify(
      loadClassificationSubject(harness.db.owner, first.taskId),
      NEVER_ABORTED
    )
    const reused = await classifier.classify(
      loadClassificationSubject(harness.db.owner, second.taskId),
      NEVER_ABORTED
    )
    expect(reused.cacheHit).toBe(true)
    expect(reused.classification).toMatchObject({
      outcome: 'classified',
      spendReservationId: null,
      rawResponseId: null,
      answers: { evidence: { cacheSource: original.classification.classificationId } }
    })
    expect(harness.transport.calls()).toBe(1)
    expect(spendRows(harness.db)).toBe(1)
    expect(harness.routing.lookups()).toBe(2)
  })

  it('never caches a blocked answer, so the same TaskSpec text is asked again', async () => {
    harness = createClassifierHarness({
      transport: transportResponding({ choices: { needs_delegation: 0.5 } })
    })
    const classifier = createTaskClassifier(harness.deps)
    for (const task of [proposeFixtureTask(harness.db), proposeFixtureTask(harness.db)]) {
      const subject = loadClassificationSubject(harness.db.owner, task.taskId)
      const result = await classifier.classify(subject, NEVER_ABORTED)
      expect(result.classification).toMatchObject({ outcome: 'blocked', detail: 'low_margin' })
    }
    expect(harness.deps.cache.size()).toBe(0)
    expect(harness.transport.calls()).toBe(2)
  })

  it('names the content-scan rule, never the matched text', async () => {
    const { result } = await classify({}, 'Read C:\\Users\\fixture\\notes.txt and summarize it.')
    expect(result.classification.answers).toMatchObject({
      evidence: { contentScanRules: ['windows_absolute_path'] }
    })
    expect(JSON.stringify(result.classification.answers)).not.toContain('notes.txt')
  })
})

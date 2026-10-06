import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getWorkflowRunStore } from './workflow-run-store'
import { getTaskSpecStore } from './task-spec-store'
import {
  FIXTURE_OBJECTIVE,
  createAppRunHarness,
  seedTask,
  specInput,
  type AppRunHarness
} from './app-attempt.test-fixture'
import { errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

describe('task spec store', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const store = () => getTaskSpecStore(harness.owner)
  const rowCount = () => harness.owner.db.prepare('SELECT count(*) AS n FROM task_specs').get()?.n

  it('is one store per database', () => {
    expect(getTaskSpecStore(harness.owner)).toBe(store())
  })

  describe('insert', () => {
    it('records the spec of an Orca task in an active run', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const { duplicate, record } = store().insert(specInput(task.id, harness.runId))
      expect(duplicate).toBe(false)
      expect(record).toMatchObject({
        taskId: task.id,
        runId: harness.runId,
        expectedOutputs: ['A report named `report.md`.'],
        acceptanceCriteria: ['The report names every top-level folder.'],
        machineChecks: [{ kind: 'artifact_exists', path: 'report.md' }],
        constraints: ['Do not modify any source file.'],
        accessNeed: 'read_only',
        isolationNeed: 'none',
        workflowName: null,
        dataClass: 'agent_task_spec',
        createdAt: fixtureTime(2),
        orphaned: false
      })
      expect(record.specSha256).toMatch(/^[0-9a-f]{64}$/)
    })

    it('allows a TaskSpec with no machine checks and records no review request', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const { record } = store().insert(specInput(task.id, harness.runId, { machineChecks: [] }))
      expect(record.machineChecks).toEqual([])
      expect(record.review).toBeNull()
    })

    it('stores lists past the old 32 x 2,000 bounds and a model review request (D-027)', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const criteria = Array.from({ length: 40 }, (_, i) => `Rule ${i}: ${'x'.repeat(2_500)}`)
      const checks = Array.from({ length: 20 }, () => ({ kind: 'executor_completed' }))
      const { record } = store().insert(
        specInput(task.id, harness.runId, {
          acceptanceCriteria: criteria,
          machineChecks: checks,
          review: 'model'
        })
      )
      expect(record.acceptanceCriteria).toEqual(criteria)
      expect(record.machineChecks).toHaveLength(20)
      expect(record.review).toBe('model')
    })

    it('gives a review request its own spec hash', () => {
      const plain = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const reviewed = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const first = store().insert(specInput(plain.id, harness.runId)).record
      const second = store().insert(
        specInput(reviewed.id, harness.runId, { review: 'model' })
      ).record
      expect(second.specSha256).not.toBe(first.specSha256)
    })

    it('allows empty lists everywhere and a workflow name', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const { record } = store().insert(
        specInput(task.id, harness.runId, {
          expectedOutputs: [],
          acceptanceCriteria: [],
          constraints: [],
          machineChecks: [],
          workflowName: 'release-notes',
          isolationNeed: 'worktree',
          accessNeed: 'workspace_write'
        })
      )
      expect(record).toMatchObject({
        workflowName: 'release-notes',
        isolationNeed: 'worktree',
        accessNeed: 'workspace_write'
      })
    })

    it('returns the existing record for the same content and changes nothing', () => {
      const { taskId } = seedTask(harness)
      const again = store().insert(specInput(taskId, harness.runId))
      expect(again.duplicate).toBe(true)
      expect(rowCount()).toBe(1)
    })

    it('refuses a second, different spec for the same task', () => {
      const { taskId } = seedTask(harness)
      const changed = specInput(taskId, harness.runId, { acceptanceCriteria: ['Another rule.'] })
      expect(errorCodeOf(() => store().insert(changed))).toBe('autopilot_task_spec_conflict')
      expect(store().get(taskId)?.acceptanceCriteria).toEqual([
        'The report names every top-level folder.'
      ])
    })

    it('hashes the objective and every field, whatever the key order of a check', () => {
      const first = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const second = harness.owner.createTask({
        spec: 'A different objective.',
        runId: harness.runId
      })
      const third = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const fourth = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const a = store().insert(specInput(first.id, harness.runId))
      const b = store().insert(specInput(second.id, harness.runId))
      const c = store().insert(
        specInput(third.id, harness.runId, {
          machineChecks: [{ path: 'report.md', kind: 'artifact_exists' }]
        })
      )
      const d = store().insert(specInput(fourth.id, harness.runId, { constraints: [] }))
      expect(b.record.specSha256).not.toBe(a.record.specSha256)
      expect(c.record.specSha256).toBe(a.record.specSha256)
      expect(d.record.specSha256).not.toBe(a.record.specSha256)
    })

    it('refuses a task Orca does not have, and one that belongs to another Orca run', () => {
      expect(errorCodeOf(() => store().insert(specInput('task_missing', harness.runId)))).toBe(
        'autopilot_task_not_found'
      )
      const other = harness.owner.createRun({
        objective: 'Another run.',
        coordinatorHandle: null,
        coordinatorPaneKey: null
      })
      const foreign = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: other.id })
      expect(errorCodeOf(() => store().insert(specInput(foreign.id, harness.runId)))).toBe(
        'autopilot_task_not_found'
      )
      expect(rowCount()).toBe(0)
    })

    it('refuses a workflow run that is unknown or no longer active', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      expect(
        errorCodeOf(() =>
          store().insert(specInput(task.id, 'run_unknown', { timestamp: fixtureTime(2) }))
        )
      ).toBe('autopilot_run_not_found')
      getWorkflowRunStore(harness.owner).transition({
        runId: harness.runId,
        from: 'active',
        to: 'canceled',
        expectedRevision: 2,
        reason: 'user_canceled',
        timestamp: fixtureTime(5)
      })
      expect(errorCodeOf(() => store().insert(specInput(task.id, harness.runId)))).toBe(
        'autopilot_run_not_live'
      )
      expect(rowCount()).toBe(0)
    })

    it('stores secret-shaped and control-character text as written (D-027 restriction 6)', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const { record } = store().insert(
        specInput(task.id, harness.runId, {
          acceptanceCriteria: [`Use ${FAKE_SECRET} to log in.`],
          constraints: ['bad\u0000text'],
          machineChecks: [{ kind: 'x_check', note: FAKE_SECRET }]
        })
      )
      expect(record.acceptanceCriteria).toEqual([`Use ${FAKE_SECRET} to log in.`])
      expect(record.constraints).toEqual(['bad\u0000text'])
      expect(rowCount()).toBe(1)
    })

    it('refuses malformed input and names only the offending fields', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      const base = specInput(task.id, harness.runId)
      const bad: Record<string, unknown>[] = [
        { ...base, expectedOutputs: 'one output' },
        { ...base, constraints: [''] },
        { ...base, machineChecks: [{ path: 'report.md' }] },
        { ...base, machineChecks: [{ kind: 'Not A Code' }] },
        { ...base, machineChecks: [{ kind: 'artifact_exists', nested: { deep: 1 } }] },
        { ...base, review: 'machine' },
        { ...base, accessNeed: 'write_everything' },
        { ...base, isolationNeed: 'sandbox' },
        { ...base, workflowName: '' },
        { ...base, extra: true },
        { ...base, timestamp: '2026-10-05 00:00:00' },
        { ...base, taskId: 'has space' }
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => store().insert(input as never))).toBe('autopilot_invalid_input')
      }
      expect(rowCount()).toBe(0)
    })

    it('opens its own transaction and refuses a connection that is already in one', () => {
      const task = harness.owner.createTask({ spec: FIXTURE_OBJECTIVE, runId: harness.runId })
      harness.owner.db.exec('BEGIN IMMEDIATE')
      try {
        expect(errorCodeOf(() => store().insert(specInput(task.id, harness.runId)))).toBe(
          'autopilot_transaction_unavailable'
        )
      } finally {
        harness.owner.db.exec('ROLLBACK')
      }
    })
  })

  describe('reads', () => {
    it('returns null for an unknown task', () => {
      expect(store().get('task_unknown')).toBeNull()
    })

    it('lists the specs of one run in creation order and bounds the limit', () => {
      const first = seedTask(harness)
      const second = seedTask(harness)
      expect(
        store()
          .listByRun(harness.runId, 10)
          .map((record) => record.taskId)
      ).toEqual([first.taskId, second.taskId])
      expect(store().listByRun(harness.runId, 1)).toHaveLength(1)
      expect(store().listByRun('run_other', 10)).toEqual([])
      expect(errorCodeOf(() => store().listByRun(harness.runId, 0))).toBe('autopilot_invalid_input')
      expect(errorCodeOf(() => store().listByRun(harness.runId, 1001))).toBe(
        'autopilot_invalid_input'
      )
    })

    it('reports a spec as orphaned once Orca no longer has its task', () => {
      const { taskId } = seedTask(harness)
      expect(store().get(taskId)?.orphaned).toBe(false)
      harness.owner.resetTasks()
      expect(store().get(taskId)?.orphaned).toBe(true)
      expect(store().listByRun(harness.runId, 10)[0]?.orphaned).toBe(true)
    })
  })
})

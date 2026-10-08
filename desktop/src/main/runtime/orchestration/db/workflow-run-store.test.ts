import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import {
  getWorkflowRunStore,
  type WorkflowRunCreate,
  type WorkflowRunStore
} from './workflow-run-store'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime
} from './autopilot-runtime.test-fixture'

const runInput = (overrides: Partial<WorkflowRunCreate> = {}): WorkflowRunCreate => ({
  runId: 'run_fixture01',
  requestId: 'request_fixture01',
  workspaceId: 'fixture-repo::/fixture/repo',
  workspaceBinding: FIXTURE_HASH_A,
  requestedAccess: 'read_only',
  routingTableVersion: 1,
  routingTableSha256: FIXTURE_HASH_B,
  coordinatorAgent: 'claude',
  coordinatorModel: 'claude-opus-5-5',
  coordinatorEffort: 'max',
  timestamp: fixtureTime(),
  ...overrides
})

describe('workflow run store', () => {
  let owner: OrchestrationDb
  let store: WorkflowRunStore
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    store = getWorkflowRunStore(owner)
  })
  afterEach(() => owner.close())

  const orcaRunCount = () => owner.db.prepare('SELECT count(*) AS n FROM runs').get()?.n

  it('is one store per database and creates the schema on first use', () => {
    expect(getWorkflowRunStore(owner)).toBe(store)
    expect(owner.db.prepare('SELECT version FROM autopilot_runtime_schema').get()).toEqual({
      version: 2
    })
  })

  describe('create', () => {
    it('records a launching run at revision 1 without touching Orca runs', () => {
      const orcaBefore = orcaRunCount()
      const result = store.create(runInput())
      expect(result.duplicate).toBe(false)
      expect(result.run).toEqual({
        runId: 'run_fixture01',
        requestId: 'request_fixture01',
        workspaceId: 'fixture-repo::/fixture/repo',
        workspaceBinding: FIXTURE_HASH_A,
        status: 'launching',
        revision: 1,
        requestedAccess: 'read_only',
        coordinatorAgent: 'claude',
        routingTableVersion: 1,
        routingTableSha256: FIXTURE_HASH_B,
        coordinatorModel: 'claude-opus-5-5',
        coordinatorEffort: 'max',
        endReason: null,
        createdAt: fixtureTime(),
        updatedAt: fixtureTime(),
        endedAt: null
      })
      expect(orcaRunCount()).toBe(orcaBefore)
      expect(store.get('run_fixture01')).toEqual(result.run)
      expect(store.getByRequestId('request_fixture01')).toEqual(result.run)
    })

    it('pins Codex for a new run', () => {
      const result = store.create(
        runInput({
          coordinatorAgent: 'codex',
          coordinatorModel: 'gpt-6.1-sol'
        })
      )
      expect(result.run).toMatchObject({ coordinatorAgent: 'codex' })
      expect(store.get(result.run.runId)?.coordinatorAgent).toBe('codex')
    })

    it('returns the existing run for a repeated request instead of starting another', () => {
      const first = store.create(runInput())
      const again = store.create(runInput({ runId: 'run_fixture02', timestamp: fixtureTime(60) }))
      expect(again).toEqual({ duplicate: true, run: first.run })
      expect(store.get('run_fixture02')).toBeNull()
    })

    it('refuses a run id already used by another request', () => {
      store.create(runInput())
      expect(errorCodeOf(() => store.create(runInput({ requestId: 'request_fixture02' })))).toBe(
        'autopilot_run_conflict'
      )
    })

    it.each([
      ['an empty run id', { runId: '' }],
      ['a run id with spaces', { runId: 'run fixture' }],
      ['a binding that is empty', { workspaceBinding: '' }],
      ['an unknown access level', { requestedAccess: 'admin' }],
      ['a missing primary agent', { coordinatorAgent: undefined }],
      ['an unknown primary agent', { coordinatorAgent: 'antigravity' }],
      ['a table version of zero', { routingTableVersion: 0 }],
      ['a table hash that is not sha256 hex', { routingTableSha256: 'not-a-hash' }],
      ['an upper-case table hash', { routingTableSha256: 'A'.repeat(64) }],
      ['an effort no CLI offers', { coordinatorEffort: 'extreme' }],
      ['a model id with a shell character', { coordinatorModel: 'claude;rm' }],
      ['a timestamp that is not UTC ISO', { timestamp: '2026-10-05 00:00:00' }]
    ])('refuses %s with autopilot_invalid_input and writes nothing', (_label, overrides) => {
      expect(
        errorCodeOf(() => store.create(runInput(overrides as Partial<WorkflowRunCreate>)))
      ).toBe('autopilot_invalid_input')
      expect(owner.db.prepare('SELECT count(*) AS n FROM workflow_runs').get()?.n).toBe(0)
    })

    it('refuses fields it was not designed to hold', () => {
      const extra = { ...runInput(), objective: 'secret objective text' }
      expect(errorCodeOf(() => store.create(extra))).toBe('autopilot_invalid_input')
    })
  })

  describe('transition', () => {
    const create = () => store.create(runInput()).run
    const move = (
      to: Parameters<WorkflowRunStore['transition']>[0]['to'],
      from: Parameters<WorkflowRunStore['transition']>[0]['from'],
      expectedRevision: number,
      reason: string | null = null,
      timestamp = fixtureTime(10)
    ) => store.transition({ runId: 'run_fixture01', from, to, expectedRevision, reason, timestamp })

    it('walks launching to active to completing to completed, bumping the revision', () => {
      create()
      expect(move('active', 'launching', 1)).toMatchObject({ status: 'active', revision: 2 })
      expect(move('completing', 'active', 2)).toMatchObject({ status: 'completing', revision: 3 })
      const done = move('completed', 'completing', 3, null, fixtureTime(20))
      expect(done).toMatchObject({
        status: 'completed',
        revision: 4,
        endReason: null,
        updatedAt: fixtureTime(20),
        endedAt: fixtureTime(20)
      })
    })

    it('lets a refused run-complete go back from completing to active', () => {
      create()
      move('active', 'launching', 1)
      move('completing', 'active', 2)
      expect(move('active', 'completing', 3)).toMatchObject({ status: 'active', revision: 4 })
    })

    it('requires a reason code for failed, canceled and unverifiable, and none otherwise', () => {
      create()
      move('active', 'launching', 1)
      expect(errorCodeOf(() => move('failed', 'active', 2))).toBe('autopilot_invalid_reason')
      expect(errorCodeOf(() => move('canceled', 'active', 2, 'User said stop!'))).toBe(
        'autopilot_invalid_reason'
      )
      expect(errorCodeOf(() => move('completing', 'active', 2, 'because'))).toBe(
        'autopilot_invalid_reason'
      )
      expect(store.get('run_fixture01')).toMatchObject({ status: 'active', revision: 2 })
      expect(move('canceled', 'active', 2, 'user_canceled')).toMatchObject({
        status: 'canceled',
        endReason: 'user_canceled',
        endedAt: fixtureTime(10)
      })
    })

    it('keeps an unverifiable run open and clears its reason when it is reconciled', () => {
      create()
      move('active', 'launching', 1)
      const unverifiable = move('unverifiable', 'active', 2, 'incarnation_mismatch')
      expect(unverifiable).toMatchObject({
        status: 'unverifiable',
        endReason: 'incarnation_mismatch',
        endedAt: null
      })
      expect(move('active', 'unverifiable', 3)).toMatchObject({
        status: 'active',
        endReason: null,
        endedAt: null
      })
    })

    it('refuses an edge that is not in the frozen list and changes nothing', () => {
      create()
      expect(errorCodeOf(() => move('completed', 'launching', 1))).toBe(
        'autopilot_invalid_transition'
      )
      expect(store.get('run_fixture01')).toMatchObject({ status: 'launching', revision: 1 })
    })

    it('refuses to leave a terminal status', () => {
      create()
      move('canceled', 'launching', 1, 'user_canceled')
      expect(errorCodeOf(() => move('active', 'canceled', 2))).toBe('autopilot_invalid_transition')
    })

    it('uses the revision as a compare-and-set, so a stale caller loses', () => {
      create()
      move('active', 'launching', 1)
      expect(errorCodeOf(() => move('completing', 'active', 1))).toBe('autopilot_run_conflict')
      expect(errorCodeOf(() => move('active', 'launching', 2))).toBe('autopilot_run_conflict')
      expect(store.get('run_fixture01')).toMatchObject({ status: 'active', revision: 2 })
    })

    it('reports a missing run as a conflict, never as success', () => {
      expect(
        errorCodeOf(() =>
          store.transition({
            runId: 'run_missing',
            from: 'launching',
            to: 'active',
            expectedRevision: 1,
            reason: null,
            timestamp: fixtureTime()
          })
        )
      ).toBe('autopilot_run_conflict')
    })
  })

  describe('queries', () => {
    it('lists runs by status in creation order, bounded by the limit', () => {
      store.create(runInput({ runId: 'run_a', requestId: 'request_a', timestamp: fixtureTime(1) }))
      store.create(runInput({ runId: 'run_b', requestId: 'request_b', timestamp: fixtureTime(2) }))
      store.create(runInput({ runId: 'run_c', requestId: 'request_c', timestamp: fixtureTime(3) }))
      store.transition({
        runId: 'run_b',
        from: 'launching',
        to: 'active',
        expectedRevision: 1,
        reason: null,
        timestamp: fixtureTime(4)
      })
      expect(store.listByStatus(['launching'], 10).map((run) => run.runId)).toEqual([
        'run_a',
        'run_c'
      ])
      expect(store.listByStatus(['launching', 'active'], 2).map((run) => run.runId)).toEqual([
        'run_a',
        'run_b'
      ])
      expect(store.listByStatus([], 10)).toEqual([])
      expect(errorCodeOf(() => store.listByStatus(['launching'], 0))).toBe(
        'autopilot_invalid_input'
      )
    })

    it('returns null for an unknown run or request', () => {
      expect(store.get('run_missing')).toBeNull()
      expect(store.getByRequestId('request_missing')).toBeNull()
    })
  })

  describe('database constraints hold even when the store is bypassed', () => {
    const rawUpdate = (set: string) => () =>
      owner.db.prepare(`UPDATE workflow_runs SET ${set} WHERE run_id = 'run_fixture01'`).run()

    it('refuses a terminal status without an end time, and a reason on an open run', () => {
      store.create(runInput())
      expect(rawUpdate("status = 'completed'")).toThrow(/constraint/i)
      expect(rawUpdate("end_reason = 'oops'")).toThrow(/constraint/i)
      expect(rawUpdate("status = 'failed', ended_at = '2026-10-05T00:00:00.000Z'")).toThrow(
        /constraint/i
      )
      expect(rawUpdate("status = 'resurrected'")).toThrow(/constraint/i)
    })
  })
})

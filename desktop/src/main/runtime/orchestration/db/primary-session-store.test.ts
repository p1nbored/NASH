import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getWorkflowRunStore, type WorkflowRunStore } from './workflow-run-store'
import {
  PRIMARY_SESSION_TRANSITIONS,
  getPrimarySessionStore,
  type PrimarySessionInsert,
  type PrimarySessionRunning,
  type PrimarySessionStore
} from './primary-session-store'
import { PRIMARY_SESSION_STATES } from './autopilot-run-schema-definition'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime
} from './autopilot-runtime.test-fixture'

const sessionInput = (overrides: Partial<PrimarySessionInsert> = {}): PrimarySessionInsert => ({
  runId: 'run_fixture01',
  launchOperationId: '1790000000000-0123456789abcdef0123456789abcdef',
  permissionMode: 'manual',
  requestedModel: 'claude-opus-5-5',
  requestedEffort: 'max',
  timestamp: fixtureTime(),
  ...overrides
})

const identity = (overrides: Partial<PrimarySessionRunning> = {}): PrimarySessionRunning => ({
  terminalHandle: 'terminal_fixture01',
  paneKey: 'pane_fixture01:1',
  processIncarnation: 'incarnation_fixture01',
  launchTokenSha256: FIXTURE_HASH_A,
  launchLedger: 'orca',
  receipt: { mode: 'terminal', operationId: 'operation_fixture01' },
  timestamp: fixtureTime(5),
  ...overrides
})

// Frozen on purpose: a new edge is a design change, so it must show up as a diff in this list.
const EXPECTED_EDGES = [
  ['starting', 'running'],
  ['starting', 'stopped'],
  ['starting', 'unverifiable'],
  ['running', 'stopping'],
  ['running', 'exited'],
  ['running', 'unverifiable'],
  ['stopping', 'stopped'],
  ['stopping', 'exited'],
  ['stopping', 'unverifiable'],
  ['unverifiable', 'running'],
  ['unverifiable', 'stopping'],
  ['unverifiable', 'exited']
]

describe('primary session store', () => {
  let owner: OrchestrationDb
  let runs: WorkflowRunStore
  let store: PrimarySessionStore
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    runs = getWorkflowRunStore(owner)
    store = getPrimarySessionStore(owner)
    runs.create({
      runId: 'run_fixture01',
      requestId: 'request_fixture01',
      workspaceId: 'fixture-repo::/fixture/repo',
      workspaceBinding: FIXTURE_HASH_A,
      requestedAccess: 'read_only',
      deliverableLanguage: null,
      routingTableVersion: 1,
      routingTableSha256: FIXTURE_HASH_B,
      coordinatorModel: 'claude-opus-5-5',
      coordinatorEffort: 'max',
      timestamp: fixtureTime()
    })
  })
  afterEach(() => owner.close())

  const start = (overrides: Partial<PrimarySessionInsert> = {}) =>
    store.insertStarting(sessionInput(overrides))
  const running = () => {
    const session = start()
    return store.markRunning(session.ownerId, identity())
  }
  const move = (
    ownerId: string,
    from: Parameters<PrimarySessionStore['transition']>[0]['from'],
    to: Parameters<PrimarySessionStore['transition']>[0]['to'],
    reason: string | null = null
  ) => store.transition({ ownerId, from, to, reason, timestamp: fixtureTime(30) })

  it('has exactly the frozen state edges', () => {
    const actual = PRIMARY_SESSION_STATES.flatMap((from) =>
      PRIMARY_SESSION_TRANSITIONS[from].map((to) => [from, to])
    )
    expect(actual).toEqual(EXPECTED_EDGES)
    expect(Object.isFrozen(PRIMARY_SESSION_TRANSITIONS)).toBe(true)
    expect(PRIMARY_SESSION_TRANSITIONS.stopped).toEqual([])
    expect(PRIMARY_SESSION_TRANSITIONS.exited).toEqual([])
  })

  describe('insertStarting', () => {
    it('records generation 1 as starting, with no pane identity yet', () => {
      const session = start()
      expect(session).toMatchObject({
        runId: 'run_fixture01',
        generation: 1,
        launchOperationId: '1790000000000-0123456789abcdef0123456789abcdef',
        launchLedger: null,
        terminalHandle: null,
        paneKey: null,
        processIncarnation: null,
        launchTokenSha256: null,
        permissionMode: 'manual',
        requestedModel: 'claude-opus-5-5',
        requestedEffort: 'max',
        state: 'starting',
        receipt: null,
        endReason: null,
        startedAt: fixtureTime(),
        endedAt: null
      })
      expect(session.ownerId).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/)
      expect(store.get(session.ownerId)).toEqual(session)
    })

    it('allows one live owner per run, and unverifiable still counts as live', () => {
      const first = start()
      expect(errorCodeOf(() => start({ launchOperationId: 'operation_second' }))).toBe(
        'autopilot_owner_exists'
      )
      store.markRunning(first.ownerId, identity())
      move(first.ownerId, 'running', 'unverifiable', 'incarnation_mismatch')
      expect(errorCodeOf(() => start({ launchOperationId: 'operation_second' }))).toBe(
        'autopilot_owner_exists'
      )
    })

    it('numbers the next owner generation after the previous one ended', () => {
      const first = running()
      move(first.ownerId, 'running', 'exited', 'process_exited')
      runs.transition({
        runId: 'run_fixture01',
        from: 'launching',
        to: 'active',
        expectedRevision: 1,
        reason: null,
        timestamp: fixtureTime(31)
      })
      const second = start({ launchOperationId: 'operation_second' })
      expect(second.generation).toBe(2)
      expect(store.findLiveByRun('run_fixture01')?.ownerId).toBe(second.ownerId)
      expect(store.latestForRun('run_fixture01')?.ownerId).toBe(second.ownerId)
    })

    it('refuses a launch operation id that was already used', () => {
      const first = running()
      move(first.ownerId, 'running', 'exited', 'process_exited')
      expect(errorCodeOf(() => start())).toBe('autopilot_owner_conflict')
    })

    it('requires a launching or active run', () => {
      expect(errorCodeOf(() => start({ runId: 'run_missing' }))).toBe('autopilot_run_not_found')
      runs.transition({
        runId: 'run_fixture01',
        from: 'launching',
        to: 'canceled',
        expectedRevision: 1,
        reason: 'user_canceled',
        timestamp: fixtureTime(1)
      })
      expect(errorCodeOf(() => start())).toBe('autopilot_run_not_live')
    })

    it('never relaunches into an unverifiable run', () => {
      runs.transition({
        runId: 'run_fixture01',
        from: 'launching',
        to: 'unverifiable',
        expectedRevision: 1,
        reason: 'launch_unconfirmed',
        timestamp: fixtureTime(1)
      })
      expect(errorCodeOf(() => start())).toBe('autopilot_run_not_live')
    })
  })

  describe('permission mode', () => {
    it.each(['manual', 'acceptEdits', 'plan'])('accepts %s', (permissionMode) => {
      expect(start({ permissionMode }).permissionMode).toBe(permissionMode)
    })

    it.each(['bypassPermissions', 'auto', 'dontAsk', 'default', 'Plan', '', 'plan '])(
      'refuses %j in the store with a dedicated code and writes nothing',
      (permissionMode) => {
        expect(errorCodeOf(() => start({ permissionMode }))).toBe(
          'autopilot_permission_mode_refused'
        )
        expect(owner.db.prepare('SELECT count(*) AS n FROM primary_sessions').get()?.n).toBe(0)
      }
    )

    it.each(['bypassPermissions', 'auto', 'dontAsk', 'default'])(
      'refuses %s in the database CHECK even when the store is bypassed',
      (permissionMode) => {
        expect(() =>
          owner.db
            .prepare(
              `INSERT INTO primary_sessions (owner_id, run_id, generation, launch_operation_id, permission_mode,
                requested_model, requested_effort, state, started_at, updated_at)
                VALUES ('owner_raw', 'run_fixture01', 1, 'operation_raw', ?, 'claude-opus-5-5', 'max', 'starting', ?, ?)`
            )
            .run(permissionMode, fixtureTime(), fixtureTime())
        ).toThrow(/constraint/i)
      }
    )
  })

  describe('input checks', () => {
    it.each([
      ['an effort no CLI offers', { requestedEffort: 'extreme' }],
      ['an empty model', { requestedModel: '' }],
      ['a model with a space', { requestedModel: 'claude opus' }],
      ['an empty launch operation id', { launchOperationId: '' }],
      ['a timestamp that is not UTC ISO', { timestamp: 'yesterday' }]
    ])('refuses %s', (_label, overrides) => {
      expect(errorCodeOf(() => start(overrides as Partial<PrimarySessionInsert>))).toBe(
        'autopilot_invalid_input'
      )
    })
  })

  describe('markRunning', () => {
    it('stores the pane identity and the launch receipt, and only a hash of the launch token', () => {
      const session = start()
      const result = store.markRunning(session.ownerId, identity())
      expect(result).toMatchObject({
        state: 'running',
        terminalHandle: 'terminal_fixture01',
        paneKey: 'pane_fixture01:1',
        processIncarnation: 'incarnation_fixture01',
        launchTokenSha256: FIXTURE_HASH_A,
        launchLedger: 'orca',
        receipt: { mode: 'terminal', operationId: 'operation_fixture01' },
        updatedAt: fixtureTime(5)
      })
    })

    it('refuses a raw token where a sha256 is required', () => {
      const session = start()
      expect(
        errorCodeOf(() =>
          store.markRunning(
            session.ownerId,
            identity({ launchTokenSha256: 'raw-launch-token-value' })
          )
        )
      ).toBe('autopilot_invalid_input')
      expect(store.get(session.ownerId)?.state).toBe('starting')
    })

    it('refuses an oversized or non-object receipt', () => {
      const session = start()
      const huge = { mode: 'terminal', padding: 'x'.repeat(9000) }
      expect(
        errorCodeOf(() => store.markRunning(session.ownerId, identity({ receipt: huge })))
      ).toBe('autopilot_invalid_input')
      expect(
        errorCodeOf(() =>
          store.markRunning(session.ownerId, identity({ receipt: 'terminal' as never }))
        )
      ).toBe('autopilot_invalid_input')
    })

    it('works only from starting, and only for an owner that exists', () => {
      const session = running()
      expect(errorCodeOf(() => store.markRunning(session.ownerId, identity()))).toBe(
        'autopilot_owner_conflict'
      )
      expect(errorCodeOf(() => store.markRunning('owner_missing', identity()))).toBe(
        'autopilot_owner_not_found'
      )
    })

    it('refuses a pane that is already the live primary of another run', () => {
      running()
      runs.create({
        runId: 'run_fixture02',
        requestId: 'request_fixture02',
        workspaceId: 'fixture-repo::/fixture/repo',
        workspaceBinding: FIXTURE_HASH_A,
        requestedAccess: 'read_only',
        deliverableLanguage: null,
        routingTableVersion: 1,
        routingTableSha256: FIXTURE_HASH_B,
        coordinatorModel: 'claude-opus-5-5',
        coordinatorEffort: 'max',
        timestamp: fixtureTime(1)
      })
      const other = start({ runId: 'run_fixture02', launchOperationId: 'operation_other' })
      expect(errorCodeOf(() => store.markRunning(other.ownerId, identity()))).toBe(
        'autopilot_owner_conflict'
      )
      expect(store.get(other.ownerId)?.state).toBe('starting')
    })
  })

  describe('transition', () => {
    it('follows stop: running, stopping, stopped with an end time and a reason', () => {
      const session = running()
      expect(move(session.ownerId, 'running', 'stopping')).toMatchObject({
        state: 'stopping',
        endedAt: null,
        endReason: null
      })
      expect(move(session.ownerId, 'stopping', 'stopped', 'user_stop')).toMatchObject({
        state: 'stopped',
        endReason: 'user_stop',
        endedAt: fixtureTime(30)
      })
      expect(store.findLiveByRun('run_fixture01')).toBeNull()
    })

    it('records a launch that provably had no effects as stopped, from starting', () => {
      const session = start()
      expect(
        move(session.ownerId, 'starting', 'stopped', 'launch_failed_no_effects')
      ).toMatchObject({
        state: 'stopped',
        endReason: 'launch_failed_no_effects'
      })
    })

    it('marks a throw after spawn as unverifiable from starting, with no identity needed', () => {
      const session = start()
      expect(move(session.ownerId, 'starting', 'unverifiable', 'launch_unconfirmed')).toMatchObject(
        {
          state: 'unverifiable',
          terminalHandle: null
        }
      )
      expect(errorCodeOf(() => move(session.ownerId, 'unverifiable', 'stopping'))).toBe(
        'autopilot_identity_required'
      )
      expect(errorCodeOf(() => move(session.ownerId, 'unverifiable', 'running'))).toBe(
        'autopilot_identity_required'
      )
    })

    it('reconciles an unverifiable owner back to running and clears its reason', () => {
      const session = running()
      move(session.ownerId, 'running', 'unverifiable', 'incarnation_mismatch')
      expect(move(session.ownerId, 'unverifiable', 'running')).toMatchObject({
        state: 'running',
        endReason: null,
        endedAt: null
      })
    })

    it('needs a reason code for stopped, exited and unverifiable and none otherwise', () => {
      const session = running()
      expect(errorCodeOf(() => move(session.ownerId, 'running', 'exited'))).toBe(
        'autopilot_invalid_reason'
      )
      expect(errorCodeOf(() => move(session.ownerId, 'running', 'stopping', 'because'))).toBe(
        'autopilot_invalid_reason'
      )
      expect(
        errorCodeOf(() => move(session.ownerId, 'running', 'unverifiable', 'Free text!'))
      ).toBe('autopilot_invalid_reason')
      expect(store.get(session.ownerId)?.state).toBe('running')
    })

    it('refuses edges outside the frozen list, and starting to running without an identity', () => {
      const session = start()
      expect(errorCodeOf(() => move(session.ownerId, 'starting', 'stopping'))).toBe(
        'autopilot_invalid_transition'
      )
      expect(errorCodeOf(() => move(session.ownerId, 'starting', 'exited', 'process_exited'))).toBe(
        'autopilot_invalid_transition'
      )
      expect(errorCodeOf(() => move(session.ownerId, 'starting', 'running'))).toBe(
        'autopilot_identity_required'
      )
      expect(store.get(session.ownerId)?.state).toBe('starting')
    })

    it('never leaves stopped or exited', () => {
      const session = running()
      move(session.ownerId, 'running', 'exited', 'process_exited')
      for (const to of PRIMARY_SESSION_STATES) {
        expect(
          errorCodeOf(() => move(session.ownerId, 'exited', to, 'process_exited')),
          to
        ).toBe('autopilot_invalid_transition')
      }
    })

    it('uses the stated from-state as a compare-and-set', () => {
      const session = running()
      move(session.ownerId, 'running', 'stopping')
      expect(errorCodeOf(() => move(session.ownerId, 'running', 'exited', 'process_exited'))).toBe(
        'autopilot_owner_conflict'
      )
      expect(errorCodeOf(() => move('owner_missing', 'running', 'stopping'))).toBe(
        'autopilot_owner_not_found'
      )
      expect(store.get(session.ownerId)?.state).toBe('stopping')
    })
  })

  describe('lookups', () => {
    it('finds the live owner by pane and incarnation, and not after it ended', () => {
      const session = running()
      expect(store.findLiveByPane('pane_fixture01:1', 'incarnation_fixture01')?.ownerId).toBe(
        session.ownerId
      )
      expect(store.findLiveByPane('pane_fixture01:1', 'incarnation_other')).toBeNull()
      expect(store.findLiveByPane('pane_other', 'incarnation_fixture01')).toBeNull()
      move(session.ownerId, 'running', 'exited', 'process_exited')
      expect(store.findLiveByPane('pane_fixture01:1', 'incarnation_fixture01')).toBeNull()
    })

    it('lists live owners for restart reconciliation, oldest first', () => {
      const session = start()
      expect(store.listLive(10).map((live) => live.ownerId)).toEqual([session.ownerId])
      move(session.ownerId, 'starting', 'stopped', 'launch_failed_no_effects')
      expect(store.listLive(10)).toEqual([])
      expect(errorCodeOf(() => store.listLive(0))).toBe('autopilot_invalid_input')
    })
  })

  describe('database constraints hold even when the store is bypassed', () => {
    const rawInsert = (state: string) => () =>
      owner.db
        .prepare(
          `INSERT INTO primary_sessions (owner_id, run_id, generation, launch_operation_id, permission_mode,
            requested_model, requested_effort, state, started_at, updated_at)
            VALUES ('owner_raw', 'run_fixture01', 9, 'operation_raw', 'plan', 'claude-opus-5-5', 'max', ?, ?, ?)`
        )
        .run(state, fixtureTime(), fixtureTime())

    it('refuses a second live owner for a run', () => {
      start()
      expect(rawInsert('starting')).toThrow(/constraint/i)
      expect(rawInsert('unverifiable')).toThrow(/constraint/i)
    })

    it('refuses a running owner without a pane identity or a receipt', () => {
      const session = start()
      move(session.ownerId, 'starting', 'stopped', 'launch_failed_no_effects')
      expect(rawInsert('running')).toThrow(/constraint/i)
    })

    it('refuses an ended owner without an end time and an end time on a live owner', () => {
      const session = start()
      move(session.ownerId, 'starting', 'stopped', 'launch_failed_no_effects')
      expect(rawInsert('exited')).toThrow(/constraint/i)
      expect(() =>
        owner.db
          .prepare(
            "UPDATE primary_sessions SET ended_at = ? WHERE owner_id = ? AND state = 'stopped'"
          )
          .run(null, session.ownerId)
      ).toThrow(/constraint/i)
    })
  })
})

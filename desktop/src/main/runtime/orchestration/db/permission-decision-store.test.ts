import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getPrimarySessionStore } from './primary-session-store'
import {
  PERMISSION_PENDING_LIMIT_PER_OWNER,
  getPermissionDecisionStore,
  type PermissionDecisionCreate,
  type PermissionDecisionStore
} from './permission-decision-store'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime,
  seedRunWithRunningOwner
} from './autopilot-runtime.test-fixture'

const DEADLINE = fixtureTime(240)

describe('permission decision store', () => {
  let owner: OrchestrationDb
  let store: PermissionDecisionStore
  let ownerId: string

  const request = (
    overrides: Partial<PermissionDecisionCreate> = {}
  ): PermissionDecisionCreate => ({
    runId: 'run_fixture01',
    ownerId,
    agentId: null,
    toolName: 'Bash',
    summary: 'Bash: git status',
    requestSha256: FIXTURE_HASH_A,
    deadlineAt: DEADLINE,
    timestamp: fixtureTime(10),
    ...overrides
  })
  const answer = (
    decisionId: string,
    decision: 'allowed' | 'denied',
    decidedBy: 'dot' | 'desktop',
    timestamp = fixtureTime(20)
  ) => store.answer({ decisionId, decision, decidedBy, timestamp })

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ownerId = seedRunWithRunningOwner(owner).ownerId
    store = getPermissionDecisionStore(owner)
  })
  afterEach(() => owner.close())

  describe('create', () => {
    it('records a pending decision holding only a redacted summary and the request hash', () => {
      const record = store.create(request({ agentId: 'agent_fixture01' }))
      expect(record).toEqual({
        decisionId: record.decisionId,
        runId: 'run_fixture01',
        ownerId,
        agentId: 'agent_fixture01',
        toolName: 'Bash',
        summary: 'Bash: git status',
        requestSha256: FIXTURE_HASH_A,
        status: 'pending',
        decidedBy: null,
        createdAt: fixtureTime(10),
        deadlineAt: DEADLINE,
        decidedAt: null
      })
      expect(record.decisionId).toMatch(/^[A-Za-z0-9_.:-]{16,128}$/)
      expect(store.get(record.decisionId)).toEqual(record)
    })

    it('has no column that could hold a request body or file contents', () => {
      const columns = owner.db
        .prepare('PRAGMA table_info(permission_decisions)')
        .all()
        .map((row) => String(row.name))
      expect(columns.sort()).toEqual(
        [
          'agent_id',
          'created_at',
          'decided_at',
          'decided_by',
          'deadline_at',
          'decision_id',
          'owner_id',
          'request_sha256',
          'run_id',
          'sequence',
          'status',
          'summary',
          'tool_name'
        ].sort()
      )
    })

    it('accepts summaries that were already masked, because masking them again changes nothing', () => {
      for (const summary of [
        'Bash: deploy --password [redacted]',
        'Bash: curl -H "Authorization: Bearer [redacted]" https://example.test/api',
        'Bash: export API_KEY=[redacted]',
        'Edit: src/main/app.ts',
        'Write: C:\\Users\\fixture\\notes.txt',
        'Read: docs/\u4e2d\u6587.md'
      ]) {
        expect(() => store.create(request({ summary })), summary).not.toThrow()
      }
    })

    it('refuses a summary that still holds a secret, as unredacted, and stores nothing', () => {
      for (const summary of [
        'Bash: deploy --password hunter2hunter2',
        'Bash: export API_KEY=abcd1234efgh5678',
        'Bash: echo sk-FIXTURE_ONLY_0000000000',
        'Bash: curl -H "Authorization: Bearer FIXTUREONLY12345678"',
        'Bash: git clone https://fixtureuser:fixturepass@example.test/repo.git'
      ]) {
        expect(
          errorCodeOf(() => store.create(request({ summary }))),
          summary
        ).toBe('autopilot_summary_unredacted')
      }
      expect(owner.db.prepare('SELECT count(*) AS n FROM permission_decisions').get()?.n).toBe(0)
    })

    it('holds a summary to 500 characters, counting code points, and one line', () => {
      expect(() => store.create(request({ summary: 'x'.repeat(500) }))).not.toThrow()
      expect(() => store.create(request({ summary: '\u{1f600}'.repeat(500) }))).not.toThrow()
      for (const summary of [
        'x'.repeat(501),
        '\u{1f600}'.repeat(501),
        '',
        'line one\nline two',
        'line one\r\nline two',
        'tab\there',
        'nul\u0000byte',
        'separator\u2028here'
      ]) {
        expect(
          errorCodeOf(() => store.create(request({ summary }))),
          JSON.stringify(summary)
        ).toBe('autopilot_invalid_input')
      }
    })

    it.each([
      ['an empty tool name', { toolName: '' }],
      ['a tool name with a space', { toolName: 'Bash tool' }],
      ['an agent id with a slash', { agentId: 'agent/one' }],
      ['a hash that is not sha256 hex', { requestSha256: 'abc' }],
      ['a deadline that is not UTC ISO', { deadlineAt: 'soon' }],
      ['a deadline not after the creation time', { deadlineAt: fixtureTime(10) }],
      ['a deadline more than 15 minutes away', { deadlineAt: fixtureTime(10 + 901) }]
    ])('refuses %s', (_label, overrides) => {
      expect(errorCodeOf(() => store.create(request(overrides)))).toBe('autopilot_invalid_input')
    })

    it('refuses fields it was not designed to hold, such as the tool input', () => {
      const withInput = { ...request(), toolInput: { file_path: 'a.txt', content: 'secret body' } }
      expect(errorCodeOf(() => store.create(withInput))).toBe('autopilot_invalid_input')
    })

    it('needs a running owner that belongs to the run', () => {
      expect(errorCodeOf(() => store.create(request({ ownerId: 'owner_missing' })))).toBe(
        'autopilot_owner_not_found'
      )
      expect(errorCodeOf(() => store.create(request({ runId: 'run_other' })))).toBe(
        'autopilot_owner_not_found'
      )
      const sessions = getPrimarySessionStore(owner)
      sessions.transition({
        ownerId,
        from: 'running',
        to: 'stopping',
        reason: null,
        timestamp: fixtureTime(11)
      })
      expect(errorCodeOf(() => store.create(request()))).toBe('autopilot_owner_not_live')
    })

    it('bounds pending decisions per owner and frees a slot when one is answered', () => {
      const created = Array.from({ length: PERMISSION_PENDING_LIMIT_PER_OWNER }, () =>
        store.create(request())
      )
      expect(errorCodeOf(() => store.create(request()))).toBe(
        'autopilot_permission_capacity_exceeded'
      )
      answer(created[0].decisionId, 'denied', 'desktop')
      expect(() => store.create(request())).not.toThrow()
    })

    it('leaves an older overdue prompt pending, so its open terminal dialog can still close it', () => {
      const older = store.create(request({ deadlineAt: fixtureTime(60) }))
      store.create(request({ timestamp: fixtureTime(100) }))
      expect(store.get(older.decisionId)?.status).toBe('pending')
    })

    it('does not count overdue prompts against the cap', () => {
      for (let index = 0; index < PERMISSION_PENDING_LIMIT_PER_OWNER; index += 1) {
        store.create(request({ deadlineAt: fixtureTime(60) }))
      }
      expect(() => store.create(request({ timestamp: fixtureTime(100) }))).not.toThrow()
    })
  })

  describe('expire (one decision)', () => {
    it('expires one pending decision whose deadline passed, only once, and no other', () => {
      const overdue = store.create(request({ deadlineAt: fixtureTime(60) }))
      const sibling = store.create(request({ deadlineAt: fixtureTime(60) }))
      expect(store.expire(overdue.decisionId, fixtureTime(100))).toBe(true)
      expect(store.expire(overdue.decisionId, fixtureTime(100))).toBe(false)
      expect(store.get(overdue.decisionId)).toMatchObject({
        status: 'expired',
        decidedBy: null,
        decidedAt: fixtureTime(100)
      })
      expect(store.get(sibling.decisionId)?.status).toBe('pending')
    })

    it('leaves a decision before its deadline, an answered one and an unknown id alone', () => {
      const open = store.create(request())
      const answered = store.create(request({ deadlineAt: fixtureTime(60) }))
      answer(answered.decisionId, 'allowed', 'dot', fixtureTime(30))
      expect(store.expire(open.decisionId, fixtureTime(100))).toBe(false)
      expect(store.expire(answered.decisionId, fixtureTime(100))).toBe(false)
      expect(store.expire('decision-that-does-not-exist', fixtureTime(100))).toBe(false)
      expect(store.get(open.decisionId)?.status).toBe('pending')
      expect(store.get(answered.decisionId)?.status).toBe('allowed')
    })
  })

  describe('answer (the first answer wins)', () => {
    it('records the first answer and who gave it', () => {
      const { decisionId } = store.create(request())
      const result = answer(decisionId, 'allowed', 'dot', fixtureTime(20))
      expect(result).toMatchObject({
        outcome: 'decided',
        record: { status: 'allowed', decidedBy: 'dot', decidedAt: fixtureTime(20) }
      })
      expect(answer(store.create(request()).decisionId, 'denied', 'desktop')).toMatchObject({
        outcome: 'decided',
        record: { status: 'denied', decidedBy: 'desktop' }
      })
    })

    it('reports a late answer as already_decided and leaves the first answer in place', () => {
      const { decisionId } = store.create(request())
      answer(decisionId, 'allowed', 'dot', fixtureTime(20))
      const late = answer(decisionId, 'denied', 'desktop', fixtureTime(21))
      expect(late).toMatchObject({
        outcome: 'already_decided',
        record: { status: 'allowed', decidedBy: 'dot', decidedAt: fixtureTime(20) }
      })
      expect(store.get(decisionId)).toMatchObject({ status: 'allowed', decidedBy: 'dot' })
    })

    it('does not let the same answerer decide twice either', () => {
      const { decisionId } = store.create(request())
      answer(decisionId, 'denied', 'desktop')
      expect(answer(decisionId, 'denied', 'desktop').outcome).toBe('already_decided')
    })

    it('reports an unknown decision as not_found', () => {
      expect(answer('decision_missing', 'allowed', 'dot')).toEqual({ outcome: 'not_found' })
    })

    it('refuses a decider the caller cannot be, and a decision that is not allowed or denied', () => {
      const { decisionId } = store.create(request())
      const bad = [
        { decisionId, decision: 'allowed', decidedBy: 'terminal', timestamp: fixtureTime(20) },
        { decisionId, decision: 'expired', decidedBy: 'dot', timestamp: fixtureTime(20) },
        { decisionId, decision: 'allowed', decidedBy: 'someone', timestamp: fixtureTime(20) },
        { decisionId, decision: 'allowed', decidedBy: 'dot', timestamp: 'later' }
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => store.answer(input as never))).toBe('autopilot_invalid_input')
      }
      expect(store.get(decisionId)?.status).toBe('pending')
    })

    it('does not let an answer win after the deadline, and closes the record as expired', () => {
      const { decisionId } = store.create(request())
      const late = answer(decisionId, 'allowed', 'dot', fixtureTime(241))
      expect(late).toMatchObject({
        outcome: 'already_decided',
        record: { status: 'expired', decidedBy: null, decidedAt: fixtureTime(241) }
      })
      expect(store.get(decisionId)).toMatchObject({ status: 'expired', decidedBy: null })
    })

    it('treats the deadline itself as expired, and the instant before it as open', () => {
      const open = store.create(request())
      expect(answer(open.decisionId, 'allowed', 'dot', fixtureTime(239.999)).outcome).toBe(
        'decided'
      )
      const closed = store.create(request())
      expect(answer(closed.decisionId, 'allowed', 'dot', DEADLINE).outcome).toBe('already_decided')
    })

    it('lets two connections race and keeps only the first answer', () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'autopilot-permission-'))
      const first = new OrchestrationDb(path.join(directory, 'orchestration.db'))
      let second: OrchestrationDb | null = null
      try {
        const { ownerId: fileOwner } = seedRunWithRunningOwner(first)
        const firstStore = getPermissionDecisionStore(first)
        const { decisionId } = firstStore.create(request({ ownerId: fileOwner }))
        second = new OrchestrationDb(path.join(directory, 'orchestration.db'))
        const secondStore = getPermissionDecisionStore(second)
        expect(secondStore.get(decisionId)?.status).toBe('pending')
        const winner = firstStore.answer({
          decisionId,
          decision: 'allowed',
          decidedBy: 'dot',
          timestamp: fixtureTime(20)
        })
        const loser = secondStore.answer({
          decisionId,
          decision: 'denied',
          decidedBy: 'desktop',
          timestamp: fixtureTime(20)
        })
        expect(winner.outcome).toBe('decided')
        expect(loser).toMatchObject({
          outcome: 'already_decided',
          record: { status: 'allowed', decidedBy: 'dot' }
        })
      } finally {
        second?.close()
        first.close()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  })

  describe('answered in the terminal', () => {
    it('closes a pending decision as answered_in_terminal, decided by the terminal', () => {
      const { decisionId } = store.create(request())
      expect(
        store.markAnsweredInTerminal({ decisionId, timestamp: fixtureTime(30) })
      ).toMatchObject({
        outcome: 'decided',
        record: {
          status: 'answered_in_terminal',
          decidedBy: 'terminal',
          decidedAt: fixtureTime(30)
        }
      })
      expect(answer(decisionId, 'allowed', 'dot', fixtureTime(31))).toMatchObject({
        outcome: 'already_decided',
        record: { status: 'answered_in_terminal', decidedBy: 'terminal' }
      })
    })

    it('does not overwrite an answer that arrived first', () => {
      const { decisionId } = store.create(request())
      answer(decisionId, 'denied', 'dot')
      expect(
        store.markAnsweredInTerminal({ decisionId, timestamp: fixtureTime(30) })
      ).toMatchObject({
        outcome: 'already_decided',
        record: { status: 'denied', decidedBy: 'dot' }
      })
    })

    it('reports an unknown decision as not_found', () => {
      expect(
        store.markAnsweredInTerminal({ decisionId: 'decision_missing', timestamp: fixtureTime(30) })
      ).toEqual({ outcome: 'not_found' })
    })
  })

  describe('queries', () => {
    it('lists pending decisions oldest first and filters by status', () => {
      const first = store.create(request({ summary: 'Bash: ls' }))
      const second = store.create(request({ summary: 'Bash: pwd' }))
      const third = store.create(request({ summary: 'Bash: id' }))
      answer(second.decisionId, 'denied', 'desktop')
      expect(store.listPending('run_fixture01', 10).map((d) => d.decisionId)).toEqual([
        first.decisionId,
        third.decisionId
      ])
      expect(
        store
          .listForRun('run_fixture01', { statuses: ['denied'], limit: 10 })
          .map((d) => d.decisionId)
      ).toEqual([second.decisionId])
      expect(store.listForRun('run_fixture01', { limit: 2 })).toHaveLength(2)
      expect(store.listPending('run_other', 10)).toEqual([])
      expect(errorCodeOf(() => store.listPending('run_fixture01', 0))).toBe(
        'autopilot_invalid_input'
      )
    })

    it('returns null for an unknown decision', () => {
      expect(store.get('decision_missing')).toBeNull()
    })
  })

  describe('database constraints hold even when the store is bypassed', () => {
    const raw = (set: string) => () =>
      owner.db.prepare(`UPDATE permission_decisions SET ${set} WHERE status = 'pending'`).run()

    it('refuses combinations of status and decider that no flow can produce', () => {
      store.create(request())
      expect(raw("status = 'allowed'")).toThrow(/constraint/i)
      expect(
        raw("status = 'allowed', decided_by = 'terminal', decided_at = '2026-10-05T00:00:30.000Z'")
      ).toThrow(/constraint/i)
      expect(
        raw(
          "status = 'answered_in_terminal', decided_by = 'dot', decided_at = '2026-10-05T00:00:30.000Z'"
        )
      ).toThrow(/constraint/i)
      expect(
        raw("status = 'expired', decided_by = 'dot', decided_at = '2026-10-05T00:00:30.000Z'")
      ).toThrow(/constraint/i)
      expect(raw("decided_by = 'dot'")).toThrow(/constraint/i)
      expect(raw("status = 'auto_allowed', decided_at = '2026-10-05T00:00:30.000Z'")).toThrow(
        /constraint/i
      )
    })

    it('refuses a summary that is long or multi-line, so file contents cannot be stored', () => {
      store.create(request())
      expect(raw(`summary = '${'x'.repeat(501)}'`)).toThrow(/constraint/i)
      expect(raw("summary = 'first' || char(10) || 'second'")).toThrow(/constraint/i)
      expect(raw("summary = ''")).toThrow(/constraint/i)
    })

    it('refuses a decision whose run is not the run of its owner', () => {
      owner.db
        .prepare(
          `INSERT INTO workflow_runs (run_id, request_id, workspace_id, workspace_binding, status, revision,
            requested_access, routing_table_version, routing_table_sha256, coordinator_model,
            coordinator_effort, created_at, updated_at) VALUES ('run_fixture02', 'request_fixture02',
            'fixture-repo::/fixture/repo', ?, 'active', 1, 'read_only', 1, ?, 'claude-opus-5-5', 'max', ?, ?)`
        )
        .run(FIXTURE_HASH_A, FIXTURE_HASH_B, fixtureTime(), fixtureTime())
      expect(() =>
        owner.db
          .prepare(
            `INSERT INTO permission_decisions (decision_id, run_id, owner_id, tool_name, summary, request_sha256,
              status, created_at, deadline_at) VALUES ('decision_raw', 'run_fixture02', ?, 'Bash', 'x', ?,
              'pending', ?, ?)`
          )
          .run(ownerId, FIXTURE_HASH_A, fixtureTime(), DEADLINE)
      ).toThrow(/constraint/i)
    })

    it('refuses a decision for an owner or run that does not exist', () => {
      expect(() =>
        owner.db
          .prepare(
            `INSERT INTO permission_decisions (decision_id, run_id, owner_id, tool_name, summary, request_sha256,
              status, created_at, deadline_at) VALUES ('decision_raw', 'run_fixture01', 'owner_missing', 'Bash', 'x', ?,
              'pending', ?, ?)`
          )
          .run(FIXTURE_HASH_A, fixtureTime(), DEADLINE)
      ).toThrow(/constraint/i)
    })
  })
})

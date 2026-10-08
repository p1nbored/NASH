import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { SCHEMA_VERSION } from './contract-constants'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { DOT_INGRESS_SCHEMA_DEFINITIONS } from './dot-ingress-schema-definition'
import { DOT_INGRESS_SCHEMA_VERSION_CURRENT, ensureDotIngressSchema } from './dot-ingress-schema'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import { getDotIngressStore } from './dot-ingress-store'
import {
  DOT_FAMILY_TABLE_NAMES,
  FIXTURE_BINDING,
  FIXTURE_OBJECTIVE,
  enableFixtureInterface,
  errorCodeOf,
  fixtureTime,
  fixtureUuid,
  isDotEntry,
  readSchemaEntries,
  readUserVersion,
  submitInput,
  type SchemaEntry
} from './dot-ingress.test-fixture'

// Pins the current schema layout.
const SCHEMA_SHA256 = '790c217ff50c496ba5a12dc79fcde64e068d353391d970f67c322a3adfc535cf'

function normalizedLayoutHash(): string {
  const text = DOT_INGRESS_SCHEMA_DEFINITIONS.map((definition) =>
    definition.sql.replace(/\s+/g, ' ').trim()
  ).join('\n')
  return createHash('sha256').update(text).digest('hex')
}

describe('dot ingress schema family', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  it('creates the whole family at version 1 and verifies it on the next start', () => {
    ensureDotIngressSchema(owner.db)
    expect(DOT_FAMILY_TABLE_NAMES).toEqual(
      [
        'dot_ingress_events',
        'dot_ingress_requests',
        'dot_ingress_schema',
        'dot_ingress_settings',
        'dot_ingress_workspaces',
        'dot_ingress_workspace_access'
      ].sort()
    )
    const tables = owner.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name))
    expect(DOT_FAMILY_TABLE_NAMES.filter((name) => !tables.includes(name))).toEqual([])
    expect(DOT_INGRESS_SCHEMA_VERSION_CURRENT).toBe(1)
    expect(owner.db.prepare('SELECT version FROM dot_ingress_schema WHERE id = 1').get()).toEqual({
      version: 1
    })
    const entries = readSchemaEntries(owner.db)
    expect(() => ensureDotIngressSchema(owner.db)).not.toThrow()
    expect(readSchemaEntries(owner.db)).toEqual(entries)
  })

  it("leaves Orca's sqlite_master entries and user_version byte-identical", () => {
    const entriesBefore = readSchemaEntries(owner.db)
    const userVersionBefore = readUserVersion(owner.db)
    expect(userVersionBefore).toBe(SCHEMA_VERSION)

    ensureDotIngressSchema(owner.db)

    const entriesAfter = readSchemaEntries(owner.db)
    expect(entriesAfter.filter((entry) => !isDotEntry(entry))).toEqual(entriesBefore)
    expect(readUserVersion(owner.db)).toBe(userVersionBefore)
    expect(entriesBefore.some(isDotEntry)).toBe(false)
    const added = entriesAfter.filter(isDotEntry).filter((entry) => entry.sql !== null)
    expect(added.map((entry) => entry.name).sort()).toEqual(
      DOT_INGRESS_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
  })

  it('stays byte-identical to Orca, the Workbench family and the autopilot family while the stores write', () => {
    ensureWorkbenchRequestSchema(owner.db)
    ensureAutopilotRuntimeSchema(owner.db)
    const foreign = (): SchemaEntry[] =>
      readSchemaEntries(owner.db).filter((entry) => !isDotEntry(entry))
    const entriesBefore = foreign()
    const userVersionBefore = readUserVersion(owner.db)

    const ref = enableFixtureInterface(owner)
    getDotIngressStore(owner).submit(submitInput(ref))
    expect(foreign()).toEqual(entriesBefore)
    expect(readUserVersion(owner.db)).toBe(userVersionBefore)
  })

  it('has no foreign key to an Orca, Workbench or autopilot table', () => {
    ensureDotIngressSchema(owner.db)
    for (const table of DOT_FAMILY_TABLE_NAMES) {
      const targets = owner.db
        .prepare(`PRAGMA foreign_key_list(${table})`)
        .all()
        .map((row) => String(row.table))
      expect(
        targets.filter((target) => !DOT_FAMILY_TABLE_NAMES.includes(target)),
        table
      ).toEqual([])
    }
  })

  it('refuses to run inside a caller transaction and writes nothing', () => {
    owner.db.exec('BEGIN')
    try {
      expect(errorCodeOf(() => ensureDotIngressSchema(owner.db))).toBe(
        'dot_transaction_unavailable'
      )
    } finally {
      owner.db.exec('ROLLBACK')
    }
    expect(readSchemaEntries(owner.db).some(isDotEntry)).toBe(false)
  })

  describe('drift fails closed with dot_recovery_required and changes nothing', () => {
    const drifts: readonly [string, (db: OrchestrationDb['db']) => void][] = [
      [
        'a table with a different layout',
        (db) => {
          db.exec('DROP TABLE dot_ingress_events')
          db.exec('CREATE TABLE dot_ingress_events (sequence INTEGER)')
        }
      ],
      ['a missing table', (db) => db.exec('DROP TABLE dot_ingress_settings')],
      ['a missing version table', (db) => db.exec('DROP TABLE dot_ingress_schema')],
      [
        'a drifted version table',
        (db) => {
          db.exec('DROP TABLE dot_ingress_schema')
          db.exec('CREATE TABLE dot_ingress_schema (id INTEGER, version INTEGER)')
          db.exec('INSERT INTO dot_ingress_schema VALUES (1, 1)')
        }
      ],
      ['a missing index', (db) => db.exec('DROP INDEX dot_ingress_request_state')],
      [
        'an index that lost its partial predicate',
        (db) => {
          db.exec('DROP INDEX dot_ingress_request_workbench')
          db.exec(
            'CREATE UNIQUE INDEX dot_ingress_request_workbench ON dot_ingress_requests (workbench_request_id)'
          )
        }
      ],
      [
        'a stored version that is not 1',
        (db) => db.exec('UPDATE dot_ingress_schema SET version = 2 WHERE id = 1')
      ],
      [
        'a weakened source CHECK',
        (db) => {
          const stored = db
            .prepare("SELECT sql FROM sqlite_master WHERE name = 'dot_ingress_requests'")
            .get()
          const weakened = String(stored?.sql).replace("source = 'dot_ingress'", "source != ''")
          expect(weakened).not.toBe(stored?.sql)
          db.exec('PRAGMA foreign_keys = OFF')
          db.exec('DROP TABLE dot_ingress_requests')
          db.exec(weakened)
          db.exec('PRAGMA foreign_keys = ON')
        }
      ]
    ]

    it.each(drifts)('%s', (_label, drift) => {
      ensureDotIngressSchema(owner.db)
      drift(owner.db)
      const before = readSchemaEntries(owner.db)
      const versionBefore = readUserVersion(owner.db)
      expect(errorCodeOf(() => ensureDotIngressSchema(owner.db))).toBe('dot_recovery_required')
      expect(readSchemaEntries(owner.db)).toEqual(before)
      expect(readUserVersion(owner.db)).toBe(versionBefore)
    })
  })

  it('stops every store from opening on a drifted layout', () => {
    ensureDotIngressSchema(owner.db)
    owner.db.exec('DROP INDEX dot_ingress_request_state')
    for (const open of [getDotIngressStore, getDotIngressSettingsStore]) {
      expect(errorCodeOf(() => open(owner))).toBe('dot_recovery_required')
    }
  })

  it('pins the current layout', () => {
    expect(normalizedLayoutHash()).toBe(SCHEMA_SHA256)
  })

  describe('row constraints', () => {
    let ref: string
    beforeEach(() => {
      ref = enableFixtureInterface(owner)
    })

    const insertRaw = (overrides: Record<string, string | number | null> = {}): void => {
      const row: Record<string, string | number | null> = {
        dot_request_id: fixtureUuid(50),
        workspace_ref: ref,
        workspace_id: 'fixture-repo::/fixture/repo',
        workspace_binding: FIXTURE_BINDING,
        source: 'dot_ingress',
        sender_auth: 'ingress_token_holder',
        data_class: 'user_task_summary',
        idempotency_key: fixtureUuid(51),
        input_hash: 'd'.repeat(64),
        objective: FIXTURE_OBJECTIVE,
        span_count: 1,
        scan_rules: '[]',
        requested_access: 'read_only',
        reply_correlation_id: null,
        client_name: null,
        client_version: null,
        state: 'received',
        revision: 1,
        workbench_idempotency_key: fixtureUuid(52),
        workbench_request_id: null,
        failure_code: null,
        created_at: fixtureTime(),
        updated_at: fixtureTime(),
        ended_at: null,
        ...overrides
      }
      const columns = Object.keys(row)
      owner.db
        .prepare(
          `INSERT INTO dot_ingress_requests (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        )
        .run(...Object.values(row))
    }
    const SUBMITTED = { state: 'submitted', workbench_request_id: 'wb-1' }

    it('accepts the baseline row, so every refusal below is caused by its one change', () => {
      expect(() => insertRaw()).not.toThrow()
      expect(() =>
        insertRaw({
          dot_request_id: fixtureUuid(53),
          idempotency_key: fixtureUuid(54),
          workbench_idempotency_key: fixtureUuid(55),
          ...SUBMITTED,
          requested_access: 'workspace_write'
        })
      ).not.toThrow()
    })

    it.each([
      ['a source that is not dot_ingress', { source: 'desktop' }],
      ['a sender that is not the token holder', { sender_auth: 'dot_verified' }],
      ['a data class other than user_task_summary', { data_class: 'agent_task_spec' }],
      ['a confirmation state, which no longer exists', { state: 'awaiting_confirmation' }],
      ['an unknown state', { state: 'approved' }],
      ['revision 0', { revision: 0 }],
      ['more than 32 spans', { span_count: 33 }],
      ['scan rules that are not a JSON array', { scan_rules: '{"a":1}' }],
      ['scan rules that are not JSON', { scan_rules: 'jwt' }],
      ['an empty objective', { objective: '' }],
      ['no requested access', { requested_access: null }],
      ['an unknown access level', { requested_access: 'admin' }],
      ['a submitted row without a Workbench link', { state: 'submitted' }],
      ['a Workbench link on a received row', { workbench_request_id: 'wb-1' }],
      [
        'a Workbench link on a failed row',
        {
          state: 'failed',
          workbench_request_id: 'wb-1',
          failure_code: 'intake_refused',
          ended_at: fixtureTime(5)
        }
      ],
      ['a failed row without a failure code', { state: 'failed', ended_at: fixtureTime(5) }],
      ['a failure code on a row that did not fail', { failure_code: 'intake_refused' }],
      [
        'an unknown failure code',
        { state: 'failed', failure_code: 'because', ended_at: fixtureTime(5) }
      ],
      ['a received row that already ended', { ended_at: fixtureTime(5) }],
      ['a submitted row that already ended', { ...SUBMITTED, ended_at: fixtureTime(5) }],
      ['a canceled row that never ended', { state: 'canceled' }],
      ['a client name without a version', { client_name: 'dot' }],
      [
        'a workspace reference that does not exist',
        { workspace_ref: 'dws_ffffffffffffffffffffffff' }
      ]
    ])('refuses %s', (_label, override) => {
      expect(() => insertRaw(override)).toThrow(/constraint/i)
    })

    it('keeps the Workbench link of a canceled request, which is the audit trail', () => {
      expect(() =>
        insertRaw({ state: 'canceled', workbench_request_id: 'wb-1', ended_at: fixtureTime(5) })
      ).not.toThrow()
    })

    it('refuses a repeated idempotency key, Workbench key, request id or Workbench link', () => {
      insertRaw()
      expect(() =>
        insertRaw({ dot_request_id: fixtureUuid(60), workbench_idempotency_key: fixtureUuid(61) })
      ).toThrow(/constraint/i)
      expect(() =>
        insertRaw({ dot_request_id: fixtureUuid(62), idempotency_key: fixtureUuid(63) })
      ).toThrow(/constraint/i)
      expect(() =>
        insertRaw({ idempotency_key: fixtureUuid(64), workbench_idempotency_key: fixtureUuid(65) })
      ).toThrow(/constraint/i)
      insertRaw({
        dot_request_id: fixtureUuid(66),
        idempotency_key: fixtureUuid(67),
        workbench_idempotency_key: fixtureUuid(68),
        ...SUBMITTED
      })
      expect(() =>
        insertRaw({
          dot_request_id: fixtureUuid(69),
          idempotency_key: fixtureUuid(70),
          workbench_idempotency_key: fixtureUuid(71),
          ...SUBMITTED
        })
      ).toThrow(/constraint/i)
    })

    it('refuses a malformed workspace reference or binding', () => {
      const insert = owner.db.prepare(
        `INSERT INTO dot_ingress_workspaces (workspace_ref, workspace_id, workspace_binding, label, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      const good = [
        'dws_0123456789abcdef01234567',
        'other::/x',
        FIXTURE_BINDING,
        'x',
        fixtureTime(),
        fixtureTime()
      ]
      expect(() => insert.run(...good)).not.toThrow()
      for (const [index, bad] of [
        [0, 'dws_0123456789ABCDEF01234567'],
        [0, 'ws_0123456789abcdef012345678'],
        [0, 'dws_0123456789abcdef0123456'],
        [2, 'short'],
        [3, '']
      ] as const) {
        const row = [...good]
        row[index] = bad
        row[1] = `other::/${String(bad)}`
        expect(() => insert.run(...row), `${index}:${bad}`).toThrow(/constraint/i)
      }
    })

    it('keeps the settings row single and the caps inside their bounds', () => {
      const insert = owner.db.prepare('INSERT INTO dot_ingress_settings VALUES (?, ?, ?, ?, ?)')
      const at = fixtureTime()
      expect(() => insert.run(2, 0, 6, 100, at)).toThrow(/constraint/i)
      expect(() => insert.run(1, 2, 6, 100, at)).toThrow(/constraint/i)
      expect(() => insert.run(1, 0, 0, 100, at)).toThrow(/constraint/i)
      expect(() => insert.run(1, 0, 61, 100, at)).toThrow(/constraint/i)
      expect(() => insert.run(1, 0, 6, 0, at)).toThrow(/constraint/i)
      expect(() => insert.run(1, 0, 6, 10_001, at)).toThrow(/constraint/i)
    })

    it('has no confirmation column in the settings or request tables', () => {
      for (const table of ['dot_ingress_settings', 'dot_ingress_requests']) {
        const columns = owner.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => String(row.name))
        expect(
          columns.filter((name) => /confirm/i.test(name)),
          table
        ).toEqual([])
      }
    })

    it('keeps events free of text: only a kind, ids, a revision and a time', () => {
      const columns = owner.db
        .prepare('PRAGMA table_info(dot_ingress_events)')
        .all()
        .map((row) => String(row.name))
      expect(columns).toEqual([
        'sequence',
        'kind',
        'dot_request_id',
        'workspace_ref',
        'revision',
        'recorded_at'
      ])
      const insert = owner.db.prepare(
        'INSERT INTO dot_ingress_events (kind, dot_request_id, workspace_ref, revision, recorded_at) VALUES (?, ?, ?, ?, ?)'
      )
      const at = fixtureTime()
      expect(() => insert.run('something_else', null, null, null, at)).toThrow(/constraint/i)
      expect(() => insert.run('confirmation_started', fixtureUuid(1), null, 1, at)).toThrow(
        /constraint/i
      )
      expect(() => insert.run('request_received', null, null, 1, at)).toThrow(/constraint/i)
      expect(() => insert.run('workspace_enabled', null, null, null, at)).toThrow(/constraint/i)
      expect(() => insert.run('ingress_enabled', fixtureUuid(1), null, 1, at)).toThrow(
        /constraint/i
      )
      expect(() => insert.run('rate_limits_changed', null, null, null, at)).not.toThrow()
    })
  })
})

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { SCHEMA_VERSION } from './contract-constants'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { getPermissionDecisionStore } from './permission-decision-store'
import { getPrimarySessionStore } from './primary-session-store'
import { getWorkflowRunStore } from './workflow-run-store'
import {
  AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS,
  AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT,
  ensureAutopilotRuntimeSchema
} from './autopilot-runtime-schema'
import {
  AUTOPILOT_FAMILY_TABLE_NAMES,
  FIXTURE_HASH_A,
  errorCodeOf,
  fixtureTime,
  insertRawRun,
  insertRawSpendReservation,
  insertRawTaskSpec,
  isAutopilotEntry,
  readSchemaEntries,
  readUserVersion,
  seedRunWithRunningOwner,
  type SchemaEntry
} from './autopilot-runtime.test-fixture'

// Pins the fresh current layout; unsupported local layouts fail closed without migration.
const SCHEMA_V2_SHA256 = '97b3d23e255d5e3511c0b93b402e2008fe8f082ae9f97f65cc34dbb747295621'

function normalizedLayoutHash(): string {
  const text = AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.map((definition) =>
    definition.sql.replace(/\s+/g, ' ').trim()
  ).join('\n')
  return createHash('sha256').update(text).digest('hex')
}

describe('autopilot runtime schema family', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  it('creates the whole family at version 2 and verifies it on the next start', () => {
    ensureAutopilotRuntimeSchema(owner.db)
    const tables = owner.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name))
    expect(AUTOPILOT_FAMILY_TABLE_NAMES.filter((name) => !tables.includes(name))).toEqual([])
    expect(AUTOPILOT_FAMILY_TABLE_NAMES).toEqual(
      [
        'attempt_artifacts',
        'autopilot_runtime_schema',
        'clef_classification_spend',
        'permission_decisions',
        'primary_sessions',
        'run_messages',
        'task_classifications',
        'task_routes',
        'task_specs',
        'task_validations',
        'workflow_runs'
      ].sort()
    )
    expect(AUTOPILOT_RUNTIME_SCHEMA_VERSION_CURRENT).toBe(2)
    expect(
      owner.db.prepare('SELECT version FROM autopilot_runtime_schema WHERE id = 1').get()
    ).toEqual({ version: 2 })
    const entries = readSchemaEntries(owner.db)
    expect(() => ensureAutopilotRuntimeSchema(owner.db)).not.toThrow()
    expect(readSchemaEntries(owner.db)).toEqual(entries)
  })

  it("leaves Orca's sqlite_master entries and user_version byte-identical", () => {
    const entriesBefore = readSchemaEntries(owner.db)
    const userVersionBefore = readUserVersion(owner.db)
    expect(userVersionBefore).toBe(SCHEMA_VERSION)

    ensureAutopilotRuntimeSchema(owner.db)

    const entriesAfter = readSchemaEntries(owner.db)
    expect(entriesAfter.filter((entry) => !isAutopilotEntry(entry))).toEqual(entriesBefore)
    expect(readUserVersion(owner.db)).toBe(userVersionBefore)
    expect(entriesBefore.some(isAutopilotEntry)).toBe(false)
    const added = entriesAfter.filter(isAutopilotEntry).filter((entry) => entry.sql !== null)
    expect(added.map((entry) => entry.name).sort()).toEqual(
      AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
  })

  it('stays byte-identical to Orca while the stores write runs, owners and decisions', () => {
    ensureWorkbenchRequestSchema(owner.db)
    const orcaEntries = (): SchemaEntry[] =>
      readSchemaEntries(owner.db).filter((entry) => !isAutopilotEntry(entry))
    const entriesBefore = orcaEntries()
    const userVersionBefore = readUserVersion(owner.db)

    const { ownerId } = seedRunWithRunningOwner(owner)
    getPermissionDecisionStore(owner).create({
      runId: 'run_fixture01',
      ownerId,
      agentId: null,
      toolName: 'Bash',
      summary: 'Bash: git status',
      requestSha256: FIXTURE_HASH_A,
      deadlineAt: fixtureTime(240),
      timestamp: fixtureTime(10)
    })

    expect(orcaEntries()).toEqual(entriesBefore)
    expect(readUserVersion(owner.db)).toBe(userVersionBefore)
  })

  it('leaves the Workbench family untouched when it already exists', () => {
    ensureWorkbenchRequestSchema(owner.db)
    const entriesBefore = readSchemaEntries(owner.db)
    ensureAutopilotRuntimeSchema(owner.db)
    expect(readSchemaEntries(owner.db).filter((entry) => !isAutopilotEntry(entry))).toEqual(
      entriesBefore
    )
    expect(readUserVersion(owner.db)).toBe(SCHEMA_VERSION)
  })

  it('refuses to run inside a caller transaction and writes nothing', () => {
    owner.db.exec('BEGIN')
    try {
      expect(errorCodeOf(() => ensureAutopilotRuntimeSchema(owner.db))).toBe(
        'autopilot_transaction_unavailable'
      )
    } finally {
      owner.db.exec('ROLLBACK')
    }
    expect(readSchemaEntries(owner.db).some(isAutopilotEntry)).toBe(false)
  })

  describe('drift fails closed with autopilot_recovery_required and changes nothing', () => {
    const drifts: readonly [string, (db: OrchestrationDb['db']) => void][] = [
      [
        'a table with a different layout',
        (db) => {
          db.exec('DROP TABLE permission_decisions')
          db.exec('CREATE TABLE permission_decisions (decision_id TEXT)')
        }
      ],
      [
        'an older schema version',
        (db) => db.exec('UPDATE autopilot_runtime_schema SET version = 1 WHERE id = 1')
      ],
      ['a missing table', (db) => db.exec('DROP TABLE clef_classification_spend')],
      ['a missing version table', (db) => db.exec('DROP TABLE autopilot_runtime_schema')],
      [
        'a drifted version table',
        (db) => {
          db.exec('DROP TABLE autopilot_runtime_schema')
          db.exec('CREATE TABLE autopilot_runtime_schema (id INTEGER, version INTEGER)')
          db.exec('INSERT INTO autopilot_runtime_schema VALUES (1, 1)')
        }
      ],
      ['a missing index', (db) => db.exec('DROP INDEX autopilot_primary_session_live_run')],
      ['a missing run message index', (db) => db.exec('DROP INDEX autopilot_run_message_scope')],
      [
        'an index that lost its partial predicate',
        (db) => {
          db.exec('DROP INDEX autopilot_primary_session_live_run')
          db.exec(
            'CREATE UNIQUE INDEX autopilot_primary_session_live_run ON primary_sessions (run_id)'
          )
        }
      ],
      [
        'an unsupported future version',
        (db) => db.exec('UPDATE autopilot_runtime_schema SET version = 3 WHERE id = 1')
      ],
      [
        'a weakened permission-mode CHECK',
        (db) => {
          const stored = db
            .prepare("SELECT sql FROM sqlite_master WHERE name = 'primary_sessions'")
            .get()
          const weakened = String(stored?.sql).replace("'plan')", "'plan', 'bypassPermissions')")
          expect(weakened).not.toBe(stored?.sql)
          db.exec('PRAGMA foreign_keys = OFF')
          db.exec('DROP TABLE primary_sessions')
          db.exec(weakened)
          db.exec('PRAGMA foreign_keys = ON')
        }
      ]
    ]

    it.each(drifts)('%s', (_label, drift) => {
      ensureAutopilotRuntimeSchema(owner.db)
      drift(owner.db)
      const before = readSchemaEntries(owner.db)
      const versionBefore = readUserVersion(owner.db)
      expect(errorCodeOf(() => ensureAutopilotRuntimeSchema(owner.db))).toBe(
        'autopilot_recovery_required'
      )
      expect(readSchemaEntries(owner.db)).toEqual(before)
      expect(readUserVersion(owner.db)).toBe(versionBefore)
    })
  })

  it('stops every store from opening on a drifted layout', () => {
    ensureAutopilotRuntimeSchema(owner.db)
    owner.db.exec('DROP INDEX autopilot_permission_decision_scope')
    for (const open of [getWorkflowRunStore, getPrimarySessionStore, getPermissionDecisionStore]) {
      expect(errorCodeOf(() => open(owner))).toBe('autopilot_recovery_required')
    }
  })

  it('pins the current layout so an unversioned change cannot ship', () => {
    expect(normalizedLayoutHash()).toBe(SCHEMA_V2_SHA256)
  })

  describe('the Clef spend link', () => {
    beforeEach(() => {
      ensureWorkbenchRequestSchema(owner.db)
      ensureAutopilotRuntimeSchema(owner.db)
      insertRawRun(owner.db, 'run_fixture01', 'request_fixture01')
      insertRawTaskSpec(owner.db, 'task_fixture01', 'run_fixture01')
    })

    it('references workbench_clef_spend by reservation id', () => {
      const keys = owner.db
        .prepare('PRAGMA foreign_key_list(clef_classification_spend)')
        .all()
        .map((row) => [row.table, row.from, row.to])
      expect(keys).toContainEqual(['workbench_clef_spend', 'reservation_id', 'reservation_id'])
    })

    it('links one reservation to one task attempt and refuses a reservation that does not exist', () => {
      insertRawSpendReservation(owner.db, 'reservation_fixture01')
      const link = owner.db.prepare(
        'INSERT INTO clef_classification_spend (reservation_id, run_id, task_id, attempt) VALUES (?, ?, ?, ?)'
      )
      expect(() => link.run('reservation_missing', 'run_fixture01', 'task_fixture01', 1)).toThrow(
        /constraint/i
      )
      link.run('reservation_fixture01', 'run_fixture01', 'task_fixture01', 1)
      expect(() => link.run('reservation_fixture01', 'run_fixture01', 'task_fixture01', 2)).toThrow(
        /constraint/i
      )
      insertRawSpendReservation(owner.db, 'reservation_fixture02')
      expect(() => link.run('reservation_fixture02', 'run_fixture01', 'task_fixture01', 1)).toThrow(
        /constraint/i
      )
      expect(() => link.run('reservation_fixture02', 'run_fixture01', 'task_fixture01', 0)).toThrow(
        /constraint/i
      )
    })
  })
})

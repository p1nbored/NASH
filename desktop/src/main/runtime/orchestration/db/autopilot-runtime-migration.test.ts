import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import {
  AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS,
  ensureAutopilotRuntimeSchema
} from './autopilot-runtime-schema'
import {
  FIXTURE_HASH_A,
  errorCodeOf,
  fixtureTime,
  insertRawRun,
  readSchemaEntries,
  readUserVersion
} from './autopilot-runtime.test-fixture'

// Frozen v2 permission table; the hash below also pins the unchanged family definitions.
const V2_PERMISSION_SQL = `CREATE TABLE permission_decisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT UNIQUE NOT NULL CHECK (length(decision_id) BETWEEN 1 AND 128),
  run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
  owner_id TEXT NOT NULL,
  agent_id TEXT CHECK (agent_id IS NULL OR length(agent_id) BETWEEN 1 AND 128),
  tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 100),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 500 AND instr(summary, char(10)) = 0 AND instr(summary, char(13)) = 0),
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'expired', 'answered_in_terminal')),
  decided_by TEXT CHECK (decided_by IS NULL OR decided_by IN ('dot', 'desktop', 'terminal')),
  created_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (owner_id, run_id) REFERENCES primary_sessions (owner_id, run_id),
  CHECK (deadline_at > created_at),
  CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('allowed', 'denied') AND decided_by IN ('dot', 'desktop') AND decided_at IS NOT NULL)
    OR (status = 'answered_in_terminal' AND decided_by = 'terminal' AND decided_at IS NOT NULL)
    OR (status = 'expired' AND decided_by IS NULL AND decided_at IS NOT NULL)
  )
)`
const V2_DEFINITIONS = AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.map((definition) => ({
  ...definition,
  sql: definition.name === 'permission_decisions' ? V2_PERMISSION_SQL : definition.sql
}))
const V2_SCHEMA_SHA256 = '97b3d23e255d5e3511c0b93b402e2008fe8f082ae9f97f65cc34dbb747295621'

describe('autopilot runtime v2 to v3 migration', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    for (const definition of V2_DEFINITIONS) {
      owner.db.exec(definition.sql)
    }
    owner.db.exec('INSERT INTO autopilot_runtime_schema VALUES (1, 2)')
    insertRawRun(owner.db, 'run_fixture01', 'request_fixture01')
    owner.db
      .prepare(`INSERT INTO primary_sessions (
      owner_id, run_id, generation, launch_operation_id, launch_ledger,
      terminal_handle, pane_key, process_incarnation, permission_mode,
      requested_model, requested_effort, state, receipt, started_at, updated_at
    ) VALUES ('owner_fixture01', 'run_fixture01', 1, 'operation_fixture01', 'orca',
      'terminal_fixture01', 'pane_fixture01:1', 'incarnation_fixture01', 'manual',
      'claude-opus-5-5', 'max', 'running', '{}', ?, ?)`)
      .run(fixtureTime(), fixtureTime())
  })
  afterEach(() => owner.close())

  function insertDecision(
    sequence: number | null,
    decisionId: string,
    status = 'pending',
    decidedBy: string | null = null
  ): void {
    owner.db
      .prepare(`INSERT INTO permission_decisions (
      sequence, decision_id, run_id, owner_id, agent_id, tool_name, summary,
      request_sha256, status, decided_by, created_at, deadline_at, decided_at
    ) VALUES (?, ?, 'run_fixture01', 'owner_fixture01', 'child_fixture01', 'Read',
      'Read: README.md', ?, ?, ?, ?, ?, ?)`)
      .run(
        sequence,
        decisionId,
        FIXTURE_HASH_A,
        status,
        decidedBy,
        fixtureTime(10),
        fixtureTime(240),
        status === 'pending' ? null : fixtureTime(20)
      )
  }

  function snapshot() {
    return {
      schema: readSchemaEntries(owner.db),
      version: owner.db.prepare('SELECT * FROM autopilot_runtime_schema').all(),
      decisions: owner.db.prepare('SELECT * FROM permission_decisions ORDER BY sequence').all(),
      sequences: owner.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
      runs: owner.db.prepare('SELECT * FROM workflow_runs').all(),
      sessions: owner.db.prepare('SELECT * FROM primary_sessions').all(),
      userVersion: readUserVersion(owner.db)
    }
  }

  it('starts from the frozen v2 family', () => {
    const layout = V2_DEFINITIONS.map((definition) =>
      definition.sql.replace(/\s+/g, ' ').trim()
    ).join('\n')
    expect(createHash('sha256').update(layout).digest('hex')).toBe(V2_SCHEMA_SHA256)
  })

  it('preserves pending and settled records, indexes, and unrelated data', () => {
    insertDecision(3, 'decision_pending')
    insertDecision(7, 'decision_allowed', 'allowed', 'dot')
    insertDecision(12, 'decision_denied', 'denied', 'desktop')
    insertDecision(15, 'decision_terminal', 'answered_in_terminal', 'terminal')
    insertDecision(21, 'decision_expired', 'expired')
    const before = snapshot()

    ensureAutopilotRuntimeSchema(owner.db)

    const after = snapshot()
    expect(after.version).toEqual([{ id: 1, version: 3 }])
    expect(after.decisions).toEqual(before.decisions)
    expect(after.sequences).toEqual(before.sequences)
    expect(after.runs).toEqual(before.runs)
    expect(after.sessions).toEqual(before.sessions)
    expect(after.userVersion).toEqual(before.userVersion)
    expect(after.schema.filter((entry) => entry.type === 'index')).toEqual(
      before.schema.filter((entry) => entry.type === 'index')
    )
    expect(after.schema.filter((entry) => entry.tbl_name !== 'permission_decisions')).toEqual(
      before.schema.filter((entry) => entry.tbl_name !== 'permission_decisions')
    )
    expect(owner.db.prepare('PRAGMA foreign_key_check(permission_decisions)').all()).toEqual([])
    expect(() => ensureAutopilotRuntimeSchema(owner.db)).not.toThrow()
    expect(snapshot()).toEqual(after)
    expect(() => insertDecision(null, 'decision_primary', 'allowed', 'primary')).not.toThrow()
    expect(
      owner.db
        .prepare('SELECT sequence FROM permission_decisions WHERE decision_id = ?')
        .get('decision_primary')
    ).toEqual({ sequence: 22 })
  })

  it('preserves the sequence high-water mark after the highest row was deleted', () => {
    insertDecision(3, 'decision_kept')
    insertDecision(100, 'decision_deleted')
    owner.db
      .prepare('DELETE FROM permission_decisions WHERE decision_id = ?')
      .run('decision_deleted')
    const before = snapshot()

    ensureAutopilotRuntimeSchema(owner.db)

    expect(snapshot().sequences).toEqual(before.sequences)
    insertDecision(null, 'decision_next')
    expect(
      owner.db
        .prepare('SELECT sequence FROM permission_decisions WHERE decision_id = ?')
        .get('decision_next')
    ).toEqual({ sequence: 101 })
  })

  it('migrates an empty table and accepts a primary decision', () => {
    ensureAutopilotRuntimeSchema(owner.db)
    expect(() => insertDecision(null, 'decision_primary', 'denied', 'primary')).not.toThrow()
    expect(() => ensureAutopilotRuntimeSchema(owner.db)).not.toThrow()
  })

  it.each([1, 4])('refuses unsupported version %s without changing data or schema', (version) => {
    insertDecision(3, 'decision_kept')
    owner.db.prepare('UPDATE autopilot_runtime_schema SET version = ?').run(version)
    const before = snapshot()

    expect(errorCodeOf(() => ensureAutopilotRuntimeSchema(owner.db))).toBe(
      'autopilot_recovery_required'
    )
    expect(snapshot()).toEqual(before)
  })

  it('refuses v2 with a missing index before writing any migration objects', () => {
    insertDecision(3, 'decision_kept')
    owner.db.exec('DROP INDEX autopilot_permission_decision_scope')
    const before = snapshot()

    expect(errorCodeOf(() => ensureAutopilotRuntimeSchema(owner.db))).toBe(
      'autopilot_recovery_required'
    )
    expect(snapshot()).toEqual(before)
  })

  it('rolls back copied rows and staging objects when replacing the old table fails', () => {
    insertDecision(3, 'decision_referenced')
    owner.db.exec(`CREATE TABLE migration_reference (
      decision_id TEXT REFERENCES permission_decisions(decision_id)
    )`)
    owner.db.exec("INSERT INTO migration_reference VALUES ('decision_referenced')")
    const before = snapshot()

    expect(() => ensureAutopilotRuntimeSchema(owner.db)).toThrow()
    expect(snapshot()).toEqual(before)
    expect(owner.db.prepare('SELECT * FROM migration_reference').all()).toEqual([
      { decision_id: 'decision_referenced' }
    ])
  })
})

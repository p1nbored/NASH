// FIXTURE_ONLY: every id, hash and model below is synthetic and describes no real run.
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS } from './autopilot-runtime-schema'
import { getPrimarySessionStore } from './primary-session-store'
import { getWorkflowRunStore } from './workflow-run-store'

export const FIXTURE_HASH_A = 'a'.repeat(64)
export const FIXTURE_HASH_B = 'b'.repeat(64)
const FIXTURE_EPOCH_MS = Date.parse('2026-10-05T00:00:00.000Z')

export function fixtureTime(offsetSeconds = 0): string {
  return new Date(FIXTURE_EPOCH_MS + offsetSeconds * 1000).toISOString()
}

export type SchemaEntry = {
  type: string
  name: string
  tbl_name: string
  sql: string | null
}

export function readSchemaEntries(db: Database.Database): SchemaEntry[] {
  return db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
    .all()
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      tbl_name: String(row.tbl_name),
      sql: typeof row.sql === 'string' ? row.sql : null
    }))
}

const FAMILY_TABLES: ReadonlySet<string> = new Set(
  AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.filter((definition) =>
    definition.sql.startsWith('CREATE TABLE')
  ).map((definition) => definition.name)
)
const FAMILY_NAMES: ReadonlySet<string> = new Set(
  AUTOPILOT_RUNTIME_SCHEMA_DEFINITIONS.map((definition) => definition.name)
)

export const AUTOPILOT_FAMILY_TABLE_NAMES: readonly string[] = [...FAMILY_TABLES].sort()

/** True for the family's tables, its indexes and SQLite's automatic indexes on those tables. */
export function isAutopilotEntry(entry: SchemaEntry): boolean {
  return FAMILY_NAMES.has(entry.name) || FAMILY_TABLES.has(entry.tbl_name)
}

export function readUserVersion(db: Database.Database): unknown {
  return db.pragma('user_version', { simple: true })
}

export function errorCodeOf(operation: () => unknown): string | null {
  try {
    operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

/** A launching run whose primary session is running in a fixture pane; returns the owner id. */
export function seedRunWithRunningOwner(owner: OrchestrationDb): { ownerId: string } {
  getWorkflowRunStore(owner).create({
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
    timestamp: fixtureTime()
  })
  const sessions = getPrimarySessionStore(owner)
  const session = sessions.insertStarting({
    runId: 'run_fixture01',
    launchOperationId: 'operation_fixture01',
    permissionMode: 'manual',
    requestedModel: 'claude-opus-5-5',
    requestedEffort: 'max',
    timestamp: fixtureTime()
  })
  sessions.markRunning(session.ownerId, {
    terminalHandle: 'terminal_fixture01',
    paneKey: 'pane_fixture01:1',
    processIncarnation: 'incarnation_fixture01',
    launchTokenSha256: FIXTURE_HASH_A,
    launchLedger: 'orca',
    receipt: { mode: 'terminal' },
    timestamp: fixtureTime(1)
  })
  return { ownerId: session.ownerId }
}

export function insertRawRun(db: Database.Database, runId: string, requestId: string): void {
  db.prepare(
    `INSERT INTO workflow_runs (run_id, request_id, workspace_id, workspace_binding, status, revision,
      requested_access, routing_table_version, routing_table_sha256,
      coordinator_model, coordinator_effort, created_at, updated_at)
      VALUES (?, ?, 'fixture-repo::/fixture/repo', ?, 'active', 1, 'read_only', 1, ?,
      'claude-opus-5-5', 'max', ?, ?)`
  ).run(runId, requestId, FIXTURE_HASH_A, FIXTURE_HASH_B, fixtureTime(), fixtureTime())
}

export function insertRawTaskSpec(db: Database.Database, taskId: string, runId: string): void {
  db.prepare(
    `INSERT INTO task_specs (task_id, run_id, spec_sha256, expected_outputs, acceptance_criteria,
      machine_checks, task_constraints, access_need, isolation_need, workflow_name, data_class, created_at)
      VALUES (?, ?, ?, '["a summary"]', '["the summary names every file"]', '[]', '[]',
      'read_only', 'none', NULL, 'agent_task_spec', ?)`
  ).run(taskId, runId, FIXTURE_HASH_A, fixtureTime())
}

/** A test-purpose reservation needs no request row, so it does not depend on the Workbench store API. */
export function insertRawSpendReservation(db: Database.Database, reservationId: string): void {
  db.prepare(
    `INSERT INTO workbench_clef_spend (reservation_id, purpose, price_basis_version,
      estimated_input_tokens, reserved_micro_usd, reserved_neurons, state, utc_day, reserved_at)
      VALUES (?, 'test', 1, 100, 10, 10, 'reserved', '2026-10-05', ?)`
  ).run(reservationId, fixtureTime())
}

// FIXTURE_ONLY: every id, hash, objective and path below is synthetic and describes no real request.
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { fixtureTime, type SchemaEntry } from './autopilot-runtime.test-fixture'
import { DOT_INGRESS_SCHEMA_DEFINITIONS } from './dot-ingress-schema-definition'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import {
  getDotIngressStore,
  type DotIngressSubmitInput,
  type DotIntakeHandle
} from './dot-ingress-store'

export {
  errorCodeOf,
  fixtureTime,
  readSchemaEntries,
  readUserVersion
} from './autopilot-runtime.test-fixture'
export type { SchemaEntry } from './autopilot-runtime.test-fixture'

export const FIXTURE_BINDING = 'c'.repeat(64)
export const FIXTURE_WORKSPACE_ID = 'fixture-repo::/fixture/repo'
export const FIXTURE_OBJECTIVE = 'Summarize the open issues in `docs/plan.md` and list the owners.'

/** A uuid-shaped key that z.uuid() accepts; n makes it distinct. */
export function fixtureUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const FAMILY_TABLES: ReadonlySet<string> = new Set(
  DOT_INGRESS_SCHEMA_DEFINITIONS.filter((definition) =>
    definition.sql.startsWith('CREATE TABLE')
  ).map((definition) => definition.name)
)
const FAMILY_NAMES: ReadonlySet<string> = new Set(
  DOT_INGRESS_SCHEMA_DEFINITIONS.map((definition) => definition.name)
)

export const DOT_FAMILY_TABLE_NAMES: readonly string[] = [...FAMILY_TABLES].sort()

/** True for the family's tables, its indexes and SQLite's automatic indexes on those tables. */
export function isDotEntry(entry: SchemaEntry): boolean {
  return FAMILY_NAMES.has(entry.name) || FAMILY_TABLES.has(entry.tbl_name)
}

/** The interface on, with one enabled workspace; returns the opaque ref a dot would send. */
export function enableFixtureInterface(
  owner: OrchestrationDb,
  workspaceId = FIXTURE_WORKSPACE_ID
): string {
  const settings = getDotIngressSettingsStore(owner)
  settings.setEnabled({ enabled: true, timestamp: fixtureTime() })
  return settings.enableWorkspace({
    workspaceId,
    workspaceBinding: FIXTURE_BINDING,
    label: 'fixture-repo',
    timestamp: fixtureTime()
  }).workspace.workspaceRef
}

export function submitInput(
  workspaceRef: string,
  overrides: Partial<DotIngressSubmitInput> = {}
): DotIngressSubmitInput {
  return {
    workspaceRef,
    workspaceBinding: FIXTURE_BINDING,
    objective: FIXTURE_OBJECTIVE,
    requestedAccess: 'read_only',
    idempotencyKey: fixtureUuid(1),
    replyCorrelationId: null,
    client: null,
    scanRules: [],
    timestamp: fixtureTime(10),
    ...overrides
  }
}

/** Submits a pending request and returns its id. */
export function submitFixtureRequest(
  owner: OrchestrationDb,
  workspaceRef: string,
  overrides: Partial<DotIngressSubmitInput> = {}
): string {
  return getDotIngressStore(owner).submit(submitInput(workspaceRef, overrides)).record.dotRequestId
}

/** Reads one raw column of a request row, bypassing every store projection. */
export function rawRequestColumn(
  db: Database.Database,
  dotRequestId: string,
  column: string
): unknown {
  return db
    .prepare(`SELECT ${column} AS value FROM dot_ingress_requests WHERE dot_request_id = ?`)
    .get(dotRequestId)?.value
}

/** The `data` an OrchestrationError carried, or undefined when nothing was thrown. */
export function errorDataOf(operation: () => unknown): unknown {
  try {
    operation()
    return undefined
  } catch (error) {
    return error instanceof OrchestrationError ? error.data : undefined
  }
}

/** The thrown message and data as one string, for proving an error never echoes request text; empty when nothing was thrown. */
export function thrownTextOf(operation: () => unknown): string {
  try {
    operation()
    return ''
  } catch (error) {
    return JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      data: error instanceof OrchestrationError ? error.data : undefined
    })
  }
}

/** Rows created long before the test clock, so they fill capacity without touching the rate windows. */
export function insertRawRequestRows(
  db: Database.Database,
  workspaceRef: string,
  rows: number,
  state: 'canceled' | 'received',
  offset = 0
): void {
  const insert = db.prepare(
    `INSERT INTO dot_ingress_requests (dot_request_id, workspace_ref, workspace_id, workspace_binding, source,
      sender_auth, data_class, idempotency_key, input_hash, objective, span_count, scan_rules, requested_access,
      state, revision, workbench_idempotency_key, created_at, updated_at, ended_at)
      VALUES (?, ?, 'fixture-repo::/fixture/repo', ?, 'dot_ingress', 'ingress_token_holder', 'user_task_summary',
      ?, ?, 'raw row', 0, '[]', 'read_only', ?, 1, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?)`
  )
  for (let i = 0; i < rows; i += 1) {
    insert.run(
      fixtureUuid(1000 + offset + i),
      workspaceRef,
      FIXTURE_BINDING,
      fixtureUuid(20_000 + offset + i),
      'a'.repeat(64),
      state,
      fixtureUuid(40_000 + offset + i),
      state === 'canceled' ? '2026-09-01T00:00:01.000Z' : null
    )
  }
}

/** The single intake door: the same idempotency key always returns the same Workbench request. */
export function createFakeDoor() {
  const created = new Map<string, string>()
  return {
    submit(handle: DotIntakeHandle): { workbenchRequestId: string; duplicate: boolean } {
      const existing = created.get(handle.workbenchIdempotencyKey)
      if (existing !== undefined) {
        return { workbenchRequestId: existing, duplicate: true }
      }
      const workbenchRequestId = `wb-${created.size + 1}`
      created.set(handle.workbenchIdempotencyKey, workbenchRequestId)
      return { workbenchRequestId, duplicate: false }
    },
    get requestCount() {
      return created.size
    }
  }
}

export function requireIntake(intake: DotIntakeHandle | null | undefined): DotIntakeHandle {
  if (!intake) {
    throw new Error('expected an intake handle')
  }
  return intake
}

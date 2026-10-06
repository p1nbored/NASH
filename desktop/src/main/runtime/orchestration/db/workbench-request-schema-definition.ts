import { DELIVERABLE_LANGUAGE_MAX_LENGTH } from '../../../../shared/deliverable-language'
import { WORKBENCH_REQUEST_ACCESS_LEVELS } from '../../../../shared/workbench-request'
import { WORKBENCH_ROUTE_SCHEMA_DEFINITIONS } from './workbench-route-schema-definition'

export const WORKBENCH_SCHEMA_VERSION_CURRENT = 3

export type WorkbenchSchemaDefinition = { readonly name: string; readonly sql: string }

/** Stored v3 request states (D-016 section 1.2); the view projects them onto its four statuses. */
export const WORKBENCH_STORED_STATUSES = [
  'RECEIVED',
  'LAUNCHING',
  'LAUNCHED',
  'LAUNCH_BLOCKED',
  'CANCELED'
] as const
export type WorkbenchStoredStatus = (typeof WORKBENCH_STORED_STATUSES)[number]

/** v2 kinds stay so migrated history still reads; `migrated` marks a v2 request requeued as RECEIVED. */
export const WORKBENCH_REQUEST_EVENT_KINDS = [
  'accepted',
  'routing_started',
  'routed',
  'routing_blocked',
  'route_discarded',
  'canceled',
  'migrated',
  'launch_started',
  'launched',
  'launch_blocked'
] as const
export type WorkbenchRequestEventKind = (typeof WORKBENCH_REQUEST_EVENT_KINDS)[number]

export const WORKBENCH_WORKFLOW_RUN_ID_MAX_LENGTH = 512

/** The SQL list literal for a CHECK, built from the same constants TypeScript validates against. */
export function workbenchSqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

/**
 * Request, event and settings layout of the intake receipt. It holds no execution state: a launched
 * request only links its workflow run.
 */
export const WORKBENCH_REQUEST_SCHEMA_DEFINITIONS = [
  {
    name: 'workbench_request_schema',
    sql: 'CREATE TABLE workbench_request_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'
  },
  {
    name: 'workbench_requests',
    sql: `CREATE TABLE workbench_requests (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_binding TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${workbenchSqlList(WORKBENCH_STORED_STATUSES)})),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      blocker_reason TEXT CHECK (blocker_reason IS NULL OR blocker_reason = 'launch_blocked'),
      blocker_detail TEXT,
      workflow_run_id TEXT CHECK (workflow_run_id IS NULL OR length(workflow_run_id) BETWEEN 1 AND ${WORKBENCH_WORKFLOW_RUN_ID_MAX_LENGTH}),
      UNIQUE (principal_id, idempotency_key),
      CHECK ((blocker_reason IS NULL) = (blocker_detail IS NULL)),
      CHECK ((status = 'LAUNCH_BLOCKED') = (blocker_reason IS NOT NULL)),
      CHECK (status <> 'LAUNCHED' OR workflow_run_id IS NOT NULL),
      CHECK (status NOT IN ('RECEIVED', 'LAUNCHING') OR workflow_run_id IS NULL)
    )`
  },
  {
    name: 'workbench_request_scope',
    sql: 'CREATE INDEX workbench_request_scope ON workbench_requests (workspace_id, workspace_binding, principal_id, sequence DESC)'
  },
  {
    name: 'workbench_request_run',
    sql: 'CREATE UNIQUE INDEX workbench_request_run ON workbench_requests (workflow_run_id) WHERE workflow_run_id IS NOT NULL'
  },
  {
    name: 'workbench_request_events',
    sql: `CREATE TABLE workbench_request_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL REFERENCES workbench_requests(request_id),
      kind TEXT NOT NULL CHECK (kind IN (${workbenchSqlList(WORKBENCH_REQUEST_EVENT_KINDS)})),
      revision INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      input_hash TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_request_event_scope',
    sql: 'CREATE INDEX workbench_request_event_scope ON workbench_request_events (request_id, sequence)'
  },
  {
    name: 'workbench_request_settings',
    sql: `CREATE TABLE workbench_request_settings (
      request_id TEXT PRIMARY KEY NOT NULL REFERENCES workbench_requests(request_id),
      requested_access TEXT NOT NULL CHECK (requested_access IN (${workbenchSqlList(WORKBENCH_REQUEST_ACCESS_LEVELS)})),
      deliverable_language TEXT CHECK (deliverable_language IS NULL OR length(deliverable_language) BETWEEN 2 AND ${DELIVERABLE_LANGUAGE_MAX_LENGTH})
    )`
  }
] as const satisfies readonly WorkbenchSchemaDefinition[]

/** Every v3 object, in creation order; the exact-SQL check compares each one. */
export const WORKBENCH_SCHEMA_DEFINITIONS: readonly WorkbenchSchemaDefinition[] = [
  ...WORKBENCH_REQUEST_SCHEMA_DEFINITIONS,
  ...WORKBENCH_ROUTE_SCHEMA_DEFINITIONS
]

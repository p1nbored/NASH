// The dot_ingress_schema family (D-016 plan 1.2, dot family): its own version row, no change to any
// Orca table, and no foreign key outside the family, because Orca's reset deletes its own rows.
// There is no confirmation state: a valid dot submission goes straight through the intake door
// (user decision 2026-10-05), so a row is only an intake receipt linking a dot request to its Workbench request.
import {
  DOT_INGRESS_DATA_CLASS,
  DOT_INGRESS_SENDER_AUTH,
  DOT_INGRESS_SOURCE,
  DOT_REQUEST_ACCESS_LEVELS,
  DOT_SUBMISSION_FAILURES
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import { DOT_REQUEST_STATES } from '../../../../shared/dot-ingress/dot-ingress-status-text'
import { sqlStringList } from './autopilot-run-schema-definition'

export type DotIngressSchemaDefinition = { readonly name: string; readonly sql: string }

export const DOT_INGRESS_EVENT_KINDS = [
  'ingress_enabled',
  'ingress_disabled',
  'rate_limits_changed',
  'workspace_enabled',
  'workspace_disabled',
  'request_received',
  'request_submitted',
  'request_failed',
  'request_canceled'
] as const

const WORKSPACE_REF_GLOB = `dws_${'[0-9a-f]'.repeat(24)}`
const UUID_LENGTH = 36
const SHA256_HEX_LENGTH = 64

export const DOT_INGRESS_SCHEMA_DEFINITIONS = [
  {
    name: 'dot_ingress_schema',
    sql: 'CREATE TABLE dot_ingress_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'
  },
  {
    // Why no column defaults: the defaults live in code (DOT_INGRESS_DEFAULT_*), so changing one never changes the frozen SQL.
    name: 'dot_ingress_settings',
    sql: `CREATE TABLE dot_ingress_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      rate_per_minute INTEGER NOT NULL CHECK (rate_per_minute BETWEEN 1 AND 60),
      rate_per_utc_day INTEGER NOT NULL CHECK (rate_per_utc_day BETWEEN 1 AND 10000),
      updated_at TEXT NOT NULL
    )`
  },
  {
    name: 'dot_ingress_workspaces',
    sql: `CREATE TABLE dot_ingress_workspaces (
      workspace_ref TEXT PRIMARY KEY NOT NULL CHECK (length(workspace_ref) = 28 AND workspace_ref GLOB '${WORKSPACE_REF_GLOB}'),
      workspace_id TEXT UNIQUE NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 512),
      workspace_binding TEXT NOT NULL CHECK (length(workspace_binding) = ${SHA256_HEX_LENGTH}),
      label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  },
  {
    name: 'dot_ingress_requests',
    sql: `CREATE TABLE dot_ingress_requests (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      dot_request_id TEXT UNIQUE NOT NULL CHECK (length(dot_request_id) = ${UUID_LENGTH}),
      workspace_ref TEXT NOT NULL REFERENCES dot_ingress_workspaces (workspace_ref),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 512),
      workspace_binding TEXT NOT NULL CHECK (length(workspace_binding) = ${SHA256_HEX_LENGTH}),
      source TEXT NOT NULL CHECK (source = '${DOT_INGRESS_SOURCE}'),
      sender_auth TEXT NOT NULL CHECK (sender_auth = '${DOT_INGRESS_SENDER_AUTH}'),
      data_class TEXT NOT NULL CHECK (data_class = '${DOT_INGRESS_DATA_CLASS}'),
      idempotency_key TEXT UNIQUE NOT NULL CHECK (length(idempotency_key) = ${UUID_LENGTH}),
      input_hash TEXT NOT NULL CHECK (length(input_hash) = ${SHA256_HEX_LENGTH}),
      objective TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 12000),
      span_count INTEGER NOT NULL CHECK (span_count BETWEEN 0 AND 32),
      scan_rules TEXT NOT NULL CHECK (json_valid(scan_rules) AND substr(scan_rules, 1, 1) = '[' AND length(scan_rules) <= 2048),
      requested_access TEXT NOT NULL CHECK (requested_access IN (${sqlStringList(DOT_REQUEST_ACCESS_LEVELS)})),
      deliverable_language TEXT CHECK (deliverable_language IS NULL OR length(deliverable_language) BETWEEN 2 AND 35),
      reply_correlation_id TEXT CHECK (reply_correlation_id IS NULL OR length(reply_correlation_id) BETWEEN 1 AND 128),
      client_name TEXT CHECK (client_name IS NULL OR length(client_name) BETWEEN 1 AND 64),
      client_version TEXT CHECK (client_version IS NULL OR length(client_version) BETWEEN 1 AND 32),
      state TEXT NOT NULL CHECK (state IN (${sqlStringList(DOT_REQUEST_STATES)})),
      revision INTEGER NOT NULL CHECK (revision > 0),
      workbench_idempotency_key TEXT UNIQUE NOT NULL CHECK (length(workbench_idempotency_key) = ${UUID_LENGTH}),
      workbench_request_id TEXT CHECK (workbench_request_id IS NULL OR length(workbench_request_id) BETWEEN 1 AND 512),
      failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN (${sqlStringList(DOT_SUBMISSION_FAILURES)})),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      CHECK ((client_name IS NULL) = (client_version IS NULL)),
      CHECK (state != 'submitted' OR workbench_request_id IS NOT NULL),
      CHECK (state NOT IN ('received', 'failed') OR workbench_request_id IS NULL),
      CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
      CHECK ((state IN ('canceled', 'failed')) = (ended_at IS NOT NULL))
    )`
  },
  {
    name: 'dot_ingress_request_state',
    sql: 'CREATE INDEX dot_ingress_request_state ON dot_ingress_requests (state, sequence)'
  },
  {
    name: 'dot_ingress_request_created',
    sql: 'CREATE INDEX dot_ingress_request_created ON dot_ingress_requests (created_at)'
  },
  {
    name: 'dot_ingress_request_workbench',
    sql: 'CREATE UNIQUE INDEX dot_ingress_request_workbench ON dot_ingress_requests (workbench_request_id) WHERE workbench_request_id IS NOT NULL'
  },
  {
    name: 'dot_ingress_events',
    sql: `CREATE TABLE dot_ingress_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN (${sqlStringList(DOT_INGRESS_EVENT_KINDS)})),
      dot_request_id TEXT CHECK (dot_request_id IS NULL OR length(dot_request_id) = ${UUID_LENGTH}),
      workspace_ref TEXT CHECK (workspace_ref IS NULL OR length(workspace_ref) = 28),
      revision INTEGER CHECK (revision IS NULL OR revision > 0),
      recorded_at TEXT NOT NULL,
      CHECK ((kind LIKE 'request_%') = (dot_request_id IS NOT NULL)),
      CHECK (kind NOT LIKE 'workspace_%' OR workspace_ref IS NOT NULL),
      CHECK (kind NOT LIKE 'ingress_%' OR (dot_request_id IS NULL AND workspace_ref IS NULL))
    )`
  },
  {
    name: 'dot_ingress_event_request',
    sql: 'CREATE INDEX dot_ingress_event_request ON dot_ingress_events (dot_request_id, sequence)'
  }
] as const satisfies readonly DotIngressSchemaDefinition[]

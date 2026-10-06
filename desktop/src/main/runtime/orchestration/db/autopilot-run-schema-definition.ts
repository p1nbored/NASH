// Run, owner and permission tables of the autopilot_runtime_schema family (D-016 plan 1.2).
// Orca ids are kept as plain text with no foreign key to an Orca table, because Orca's reset deletes those rows.
import {
  PERMISSION_DECISION_DECIDERS,
  PERMISSION_DECISION_STATUSES
} from '../../../../shared/rpc-contract/permission-decision-values'

export type AutopilotSchemaDefinition = { readonly name: string; readonly sql: string }

/** `'a', 'b'` for a CHECK list, so the TypeScript value sets and the frozen SQL cannot drift apart. */
export function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

export const WORKFLOW_RUN_STATUSES = [
  'launching',
  'active',
  'completing',
  'completed',
  'failed',
  'canceled',
  'unverifiable'
] as const
export const WORKFLOW_RUN_ACCESS_LEVELS = ['read_only', 'workspace_write'] as const
/** Every policy level (D-027); a route runs one only where the CLI lists it for the model. */
export const AUTOPILOT_EFFORT_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const

/** Claude Code 2.1.289 has no `default`; bypassPermissions, auto and dontAsk are never launched. */
export const PRIMARY_SESSION_PERMISSION_MODES = ['manual', 'acceptEdits', 'plan'] as const
export const PRIMARY_SESSION_STATES = [
  'starting',
  'running',
  'stopping',
  'stopped',
  'exited',
  'unverifiable'
] as const
/** Unverifiable stays live: a pane we cannot identify may still hold the run's primary. */
export const PRIMARY_SESSION_LIVE_STATES = [
  'starting',
  'running',
  'stopping',
  'unverifiable'
] as const
export const PRIMARY_SESSION_LEDGERS = ['orca', 'app_only'] as const
export const PRIMARY_SESSION_RECEIPT_MAX_CHARS = 8192

// Why shared: the desktop view shows the same values, so the CHECK lists and the wire read one definition.
export { PERMISSION_DECISION_DECIDERS, PERMISSION_DECISION_STATUSES }
export const PERMISSION_SUMMARY_MAX_CHARS = 500

const LIVE_STATES_SQL = sqlStringList(PRIMARY_SESSION_LIVE_STATES)

export const AUTOPILOT_RUN_SCHEMA_DEFINITIONS = [
  {
    name: 'autopilot_runtime_schema',
    sql: 'CREATE TABLE autopilot_runtime_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'
  },
  {
    name: 'workflow_runs',
    sql: `CREATE TABLE workflow_runs (
      run_id TEXT PRIMARY KEY NOT NULL CHECK (length(run_id) BETWEEN 1 AND 128),
      request_id TEXT UNIQUE NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
      workspace_id TEXT NOT NULL CHECK (length(workspace_id) BETWEEN 1 AND 512),
      workspace_binding TEXT NOT NULL CHECK (length(workspace_binding) BETWEEN 1 AND 128),
      status TEXT NOT NULL CHECK (status IN (${sqlStringList(WORKFLOW_RUN_STATUSES)})),
      revision INTEGER NOT NULL CHECK (revision > 0),
      requested_access TEXT NOT NULL CHECK (requested_access IN (${sqlStringList(WORKFLOW_RUN_ACCESS_LEVELS)})),
      deliverable_language TEXT CHECK (deliverable_language IS NULL OR length(deliverable_language) BETWEEN 2 AND 35),
      routing_table_version INTEGER NOT NULL CHECK (routing_table_version > 0),
      routing_table_sha256 TEXT NOT NULL CHECK (length(routing_table_sha256) = 64),
      coordinator_model TEXT NOT NULL CHECK (length(coordinator_model) BETWEEN 1 AND 128),
      coordinator_effort TEXT NOT NULL CHECK (coordinator_effort IN (${sqlStringList(AUTOPILOT_EFFORT_LEVELS)})),
      end_reason TEXT CHECK (end_reason IS NULL OR length(end_reason) BETWEEN 1 AND 64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      CHECK ((status IN ('failed', 'canceled', 'unverifiable')) = (end_reason IS NOT NULL)),
      CHECK ((status IN ('completed', 'failed', 'canceled')) = (ended_at IS NOT NULL))
    )`
  },
  {
    name: 'primary_sessions',
    sql: `CREATE TABLE primary_sessions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT UNIQUE NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
      generation INTEGER NOT NULL CHECK (generation > 0),
      launch_operation_id TEXT UNIQUE NOT NULL CHECK (length(launch_operation_id) BETWEEN 1 AND 128),
      launch_ledger TEXT CHECK (launch_ledger IS NULL OR launch_ledger IN (${sqlStringList(PRIMARY_SESSION_LEDGERS)})),
      terminal_handle TEXT CHECK (terminal_handle IS NULL OR length(terminal_handle) BETWEEN 1 AND 256),
      pane_key TEXT CHECK (pane_key IS NULL OR length(pane_key) BETWEEN 1 AND 256),
      process_incarnation TEXT CHECK (process_incarnation IS NULL OR length(process_incarnation) BETWEEN 1 AND 256),
      launch_token_sha256 TEXT CHECK (launch_token_sha256 IS NULL OR length(launch_token_sha256) = 64),
      permission_mode TEXT NOT NULL CHECK (permission_mode IN (${sqlStringList(PRIMARY_SESSION_PERMISSION_MODES)})),
      requested_model TEXT NOT NULL CHECK (length(requested_model) BETWEEN 1 AND 128),
      requested_effort TEXT NOT NULL CHECK (requested_effort IN (${sqlStringList(AUTOPILOT_EFFORT_LEVELS)})),
      state TEXT NOT NULL CHECK (state IN (${sqlStringList(PRIMARY_SESSION_STATES)})),
      receipt TEXT CHECK (receipt IS NULL OR (json_valid(receipt) AND length(receipt) <= ${PRIMARY_SESSION_RECEIPT_MAX_CHARS})),
      end_reason TEXT CHECK (end_reason IS NULL OR length(end_reason) BETWEEN 1 AND 64),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      UNIQUE (run_id, generation),
      UNIQUE (owner_id, run_id),
      CHECK (state NOT IN ('running', 'stopping') OR (terminal_handle IS NOT NULL AND pane_key IS NOT NULL AND process_incarnation IS NOT NULL AND launch_ledger IS NOT NULL AND receipt IS NOT NULL)),
      CHECK ((state IN ('stopped', 'exited')) = (ended_at IS NOT NULL)),
      CHECK ((state IN ('stopped', 'exited', 'unverifiable')) = (end_reason IS NOT NULL))
    )`
  },
  {
    name: 'autopilot_primary_session_live_run',
    sql: `CREATE UNIQUE INDEX autopilot_primary_session_live_run ON primary_sessions (run_id) WHERE state IN (${LIVE_STATES_SQL})`
  },
  {
    name: 'autopilot_primary_session_live_pane',
    sql: `CREATE UNIQUE INDEX autopilot_primary_session_live_pane ON primary_sessions (pane_key, process_incarnation) WHERE pane_key IS NOT NULL AND state IN (${LIVE_STATES_SQL})`
  },
  {
    name: 'permission_decisions',
    sql: `CREATE TABLE permission_decisions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id TEXT UNIQUE NOT NULL CHECK (length(decision_id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
      owner_id TEXT NOT NULL,
      agent_id TEXT CHECK (agent_id IS NULL OR length(agent_id) BETWEEN 1 AND 128),
      tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 100),
      summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND ${PERMISSION_SUMMARY_MAX_CHARS} AND instr(summary, char(10)) = 0 AND instr(summary, char(13)) = 0),
      request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
      status TEXT NOT NULL CHECK (status IN (${sqlStringList(PERMISSION_DECISION_STATUSES)})),
      decided_by TEXT CHECK (decided_by IS NULL OR decided_by IN (${sqlStringList(PERMISSION_DECISION_DECIDERS)})),
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
  },
  {
    name: 'autopilot_permission_decision_scope',
    sql: 'CREATE INDEX autopilot_permission_decision_scope ON permission_decisions (run_id, status, sequence)'
  },
  {
    name: 'autopilot_permission_decision_owner',
    sql: 'CREATE INDEX autopilot_permission_decision_owner ON permission_decisions (owner_id, status)'
  }
] as const satisfies readonly AutopilotSchemaDefinition[]

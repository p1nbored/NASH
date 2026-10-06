// Follow-up messages to a running primary session (D-019), part of autopilot_runtime_schema v1.
// The run mailbox stays for task results; these rows hold what dot or the desktop typed into a run.
import { sqlStringList, type AutopilotSchemaDefinition } from './autopilot-run-schema-definition'

export const RUN_MESSAGE_SOURCES = ['dot', 'desktop'] as const
/** received: stored, delivery in flight; held: waiting for a dialog to close; the other two are final. */
export const RUN_MESSAGE_STATES = ['received', 'held', 'delivered', 'refused'] as const
/** What the first answer to the sender said; a replay of the same request returns it unchanged. */
export const RUN_MESSAGE_OUTCOMES = ['delivered', 'queued', 'refused'] as const
/** Counted in code points, as SQLite's length() counts them; a technical ceiling only (D-027). */
export const RUN_MESSAGE_TEXT_MAX_CHARS = 65_536

export const AUTOPILOT_MESSAGE_SCHEMA_DEFINITIONS = [
  {
    name: 'run_messages',
    sql: `CREATE TABLE run_messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE NOT NULL CHECK (length(message_id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
      source TEXT NOT NULL CHECK (source IN (${sqlStringList(RUN_MESSAGE_SOURCES)})),
      source_request_id TEXT NOT NULL CHECK (length(source_request_id) BETWEEN 1 AND 128),
      text TEXT CHECK (text IS NULL OR (length(text) BETWEEN 1 AND ${RUN_MESSAGE_TEXT_MAX_CHARS} AND instr(text, char(27)) = 0 AND instr(text, char(13)) = 0)),
      text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
      state TEXT NOT NULL CHECK (state IN (${sqlStringList(RUN_MESSAGE_STATES)})),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN (${sqlStringList(RUN_MESSAGE_OUTCOMES)})),
      reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE (source, source_request_id),
      CHECK (state = 'refused' OR text IS NOT NULL),
      CHECK ((state = 'received') = (outcome IS NULL)),
      CHECK (outcome IS NULL OR outcome <> 'delivered' OR state = 'delivered'),
      CHECK (outcome IS NULL OR outcome <> 'refused' OR state = 'refused'),
      CHECK (state NOT IN ('held', 'refused') OR reason IS NOT NULL),
      CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
    )`
  },
  {
    name: 'autopilot_run_message_scope',
    sql: 'CREATE INDEX autopilot_run_message_scope ON run_messages (run_id, state, sequence)'
  }
] as const satisfies readonly AutopilotSchemaDefinition[]

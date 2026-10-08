import { randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { parseAutopilotInput } from './autopilot-store-input'
import {
  RUN_MESSAGE_COLUMNS,
  RunMessageHeldSchema,
  toRunMessageRecord,
  type RunMessageHeld,
  type RunMessageOutcome,
  type RunMessageRecord,
  type RunMessageSource,
  type RunMessageState
} from './run-message-record'

export type NewRunMessageRow = {
  runId: string
  source: RunMessageSource
  sourceRequestId: string
  text: string | null
  textSha256: string
  state: RunMessageState
  outcome: RunMessageOutcome | null
  reason: string | null
  timestamp: string
}

/** Shared insertion under the caller's transaction, so attachment and its first message commit together. */
export function insertRunMessageRow(
  db: Database.Database,
  row: NewRunMessageRow
): RunMessageRecord {
  if (!db.isTransaction) {
    throw new OrchestrationError(
      'autopilot_transaction_unavailable',
      'Message insertion requires an active transaction.'
    )
  }
  if (!db.prepare('SELECT 1 FROM workflow_runs WHERE run_id = ?').get(row.runId)) {
    throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
  }
  if (
    db
      .prepare('SELECT 1 FROM run_messages WHERE source = ? AND source_request_id = ?')
      .get(row.source, row.sourceRequestId)
  ) {
    throw new OrchestrationError(
      'autopilot_message_conflict',
      'That source already sent a message with this request id.'
    )
  }
  const messageId = `message_${randomUUID()}`
  db.prepare(`INSERT INTO run_messages (message_id, run_id, source, source_request_id, text, text_sha256,
    state, outcome, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    messageId,
    row.runId,
    row.source,
    row.sourceRequestId,
    row.text,
    row.textSha256,
    row.state,
    row.outcome,
    row.reason,
    row.timestamp,
    row.timestamp
  )
  return toRunMessageRecord(
    db
      .prepare(`SELECT ${RUN_MESSAGE_COLUMNS} FROM run_messages WHERE message_id = ?`)
      .get(messageId)
  )
}

/** Trusted runtime callers prepare message text first and initialize the schema before opening the transaction. */
export function insertHeldRunMessageInTransaction(
  db: Database.Database,
  input: RunMessageHeld
): RunMessageRecord {
  const params = parseAutopilotInput(RunMessageHeldSchema, input, 'run message')
  return insertRunMessageRow(db, { ...params, state: 'held', outcome: 'queued' })
}

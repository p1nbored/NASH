import { randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  AutopilotLimitSchema,
  changedRowCount,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import {
  RUN_MESSAGE_COLUMNS as COLUMNS,
  RUN_MESSAGE_SETTLE_FROM,
  RunMessageHeldSchema,
  RunMessageReceivedSchema,
  RunMessageRefusedSchema,
  RunMessageSettleSchema,
  toRunMessageRecord as toRecord,
  type RunMessageHeld,
  type RunMessageOutcome,
  type RunMessageReceived,
  type RunMessageRecord,
  type RunMessageRefused,
  type RunMessageSettle,
  type RunMessageSource,
  type RunMessageState
} from './run-message-record'

export type {
  RunMessageOutcome,
  RunMessageRecord,
  RunMessageSettle,
  RunMessageSource,
  RunMessageState
} from './run-message-record'

type NewRow = {
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

function conflict(message: string): OrchestrationError {
  return new OrchestrationError('autopilot_message_conflict', message)
}

const stores = new WeakMap<OrchestrationDb, RunMessageStore>()

export function getRunMessageStore(owner: OrchestrationDb): RunMessageStore {
  let store = stores.get(owner)
  if (!store) {
    store = new RunMessageStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** Follow-up messages to a run's primary session (D-019); one row per source and request id. */
export class RunMessageStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(messageId: string): RunMessageRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM run_messages WHERE message_id = ?`)
      .get(messageId)
    return row ? toRecord(row) : null
  }

  findBySource(source: RunMessageSource, sourceRequestId: string): RunMessageRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM run_messages WHERE source = ? AND source_request_id = ?`)
      .get(source, sourceRequestId)
    return row ? toRecord(row) : null
  }

  /** Held messages of one run, oldest first: they are delivered in this order. */
  listHeld(runId: string, limit: number): RunMessageRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'message list limit')
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM run_messages WHERE run_id = ? AND state = 'held' ORDER BY sequence LIMIT ?`
      )
      .all(runId, bound)
      .map(toRecord)
  }

  countHeld(runId: string): number {
    const row = this.db
      .prepare(`SELECT count(*) AS held FROM run_messages WHERE run_id = ? AND state = 'held'`)
      .get(runId)
    return Number(row?.held ?? 0)
  }

  /** Messages whose first delivery never settled, oldest first; a restart finds them here. */
  listReceived(limit: number): RunMessageRecord[] {
    const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'message list limit')
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM run_messages WHERE state = 'received' ORDER BY sequence LIMIT ?`
      )
      .all(bound)
      .map(toRecord)
  }

  /** Stored before the terminal write, so a crash during it leaves evidence. */
  recordReceived(input: RunMessageReceived): RunMessageRecord {
    const params = parseAutopilotInput(RunMessageReceivedSchema, input, 'run message')
    return this.insert({ ...params, state: 'received', outcome: null, reason: null })
  }

  recordHeld(input: RunMessageHeld): RunMessageRecord {
    const params = parseAutopilotInput(RunMessageHeldSchema, input, 'run message')
    return this.insert({ ...params, state: 'held', outcome: 'queued' })
  }

  recordRefused(input: RunMessageRefused): RunMessageRecord {
    const params = parseAutopilotInput(RunMessageRefusedSchema, input, 'run message')
    return this.insert({ ...params, state: 'refused', outcome: 'refused' })
  }

  /** Compare-and-set on the allowed source states; the first outcome is never overwritten. */
  settle(messageId: string, input: RunMessageSettle): RunMessageRecord {
    const params = parseAutopilotInput(RunMessageSettleSchema, input, 'message settle')
    if (params.to !== 'delivered' && params.reason === null) {
      throw new OrchestrationError(
        'autopilot_invalid_reason',
        `A message moving to ${params.to} needs a reason code.`
      )
    }
    const from = RUN_MESSAGE_SETTLE_FROM[params.to]
    return runAutopilotWrite(this.db, 'autopilot_message', () => {
      const placeholders = from.map(() => '?').join(', ')
      const result = this.db
        .prepare(
          `UPDATE run_messages SET state = ?, outcome = COALESCE(outcome, ?), reason = ?, updated_at = ?,
            delivered_at = ? WHERE message_id = ? AND state IN (${placeholders})`
        )
        .run(
          params.to,
          params.firstOutcome,
          params.reason,
          params.timestamp,
          params.to === 'delivered' ? params.timestamp : null,
          messageId,
          ...from
        )
      if (changedRowCount(result) !== 1) {
        throw conflict('The message changed or is already settled. Nothing was written.')
      }
      return this.requireMessage(messageId)
    })
  }

  private insert(row: NewRow): RunMessageRecord {
    const messageId = `message_${randomUUID()}`
    return runAutopilotWrite(this.db, 'autopilot_message', () => {
      const run = this.db
        .prepare('SELECT 1 AS found FROM workflow_runs WHERE run_id = ?')
        .get(row.runId)
      if (!run) {
        throw new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
      }
      if (this.findBySource(row.source, row.sourceRequestId)) {
        throw conflict('That source already sent a message with this request id.')
      }
      this.db
        .prepare(
          `INSERT INTO run_messages (message_id, run_id, source, source_request_id, text, text_sha256,
            state, outcome, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
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
      return this.requireMessage(messageId)
    })
  }

  private requireMessage(messageId: string): RunMessageRecord {
    const message = this.get(messageId)
    if (!message) {
      throw new OrchestrationError('autopilot_message_not_found', 'The message was not found.')
    }
    return message
  }
}

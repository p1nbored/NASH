import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { APP_ATTEMPT_AWAITING_VALIDATION_STAGES } from './app-attempt-stages'
import { AutopilotLimitSchema, parseAutopilotInput } from './autopilot-store-input'

export type AwaitingValidationEntry = {
  taskId: string
  runId: string
  dispatchId: string
  stage: string
  validationId: string | null
  verdict: 'pending' | 'inconclusive' | null
}

export type UnrecordedStart = { dispatchId: string; taskId: string; runId: string }

const AwaitingRowSchema = z.object({
  task_id: z.string(),
  run_id: z.string(),
  dispatch_id: z.string(),
  stage: z.string(),
  validation_id: z.string().nullable(),
  verdict: z.enum(['pending', 'inconclusive']).nullable()
})

const STAGES_SQL = APP_ATTEMPT_AWAITING_VALIDATION_STAGES.map((stage) => `'${stage}'`).join(', ')
const SELECT_AWAITING = `SELECT d.task_id, d.run_id, d.id AS dispatch_id, w.stage, v.validation_id, v.verdict
  FROM dispatch_contexts d
  JOIN worker_dispatches w ON w.dispatch_id = d.id
  JOIN tasks t ON t.id = d.task_id AND t.run_id = d.run_id
  JOIN task_specs s ON s.task_id = d.task_id AND s.run_id = d.run_id
  LEFT JOIN task_validations v ON v.sequence = (SELECT MAX(sequence) FROM task_validations x WHERE x.dispatch_id = d.id)
  WHERE d.status = 'dispatched' AND w.state = 'ready' AND t.status = 'blocked' AND w.stage IN (${STAGES_SQL})`

function awaitingEntryOf(row: unknown): AwaitingValidationEntry {
  const stored = AwaitingRowSchema.parse(row)
  return {
    taskId: stored.task_id,
    runId: stored.run_id,
    dispatchId: stored.dispatch_id,
    stage: stored.stage,
    validationId: stored.validation_id,
    verdict: stored.verdict
  }
}

/** Claimed attempts whose task waits for a validator, oldest first; each carries its validation, if opened. */
export function listAwaitingValidation(
  db: Database.Database,
  limit: number,
  options: { onlyInconclusive: boolean } = { onlyInconclusive: false }
): AwaitingValidationEntry[] {
  const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'awaiting list limit')
  const extra = options.onlyInconclusive ? " AND v.verdict = 'inconclusive'" : ''
  return db
    .prepare(`${SELECT_AWAITING}${extra} ORDER BY d.rowid LIMIT ?`)
    .all(bound)
    .map(awaitingEntryOf)
}

/** One claimed attempt waiting for a validator, by its Dispatch id; null when it is not waiting. */
export function getAwaitingValidation(
  db: Database.Database,
  dispatchId: string
): AwaitingValidationEntry | null {
  const row = db.prepare(`${SELECT_AWAITING} AND d.id = ? LIMIT 1`).get(dispatchId)
  return row ? awaitingEntryOf(row) : null
}

/** Starts whose executor row was never written (a crash between the two writes): no process can exist. */
export function listUnrecordedStarts(db: Database.Database, limit: number): UnrecordedStart[] {
  const bound = parseAutopilotInput(AutopilotLimitSchema, limit, 'start list limit')
  return db
    .prepare(
      `SELECT d.id AS dispatch_id, d.task_id, d.run_id
         FROM dispatch_contexts d
         JOIN worker_dispatches w ON w.dispatch_id = d.id
         JOIN task_specs s ON s.task_id = d.task_id AND s.run_id = d.run_id
        WHERE w.state = 'starting' AND d.status = 'pending'
          AND CASE WHEN json_valid(w.start_options) THEN json_extract(w.start_options, '$.executor') END IN ('codex_cli', 'agy_cli')
          AND NOT EXISTS (SELECT 1 FROM executor_processes e WHERE e.dispatch_id = d.id)
        ORDER BY d.rowid LIMIT ?`
    )
    .all(bound)
    .map((row) => ({
      dispatchId: String(row.dispatch_id),
      taskId: String(row.task_id),
      runId: String(row.run_id)
    }))
}

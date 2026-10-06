import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import {
  AUTOPILOT_EFFORT_LEVELS,
  WORKFLOW_RUN_ACCESS_LEVELS
} from './autopilot-run-schema-definition'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'

// Why shared: the wire contracts carry the same ids and tool names, so both read one definition.
export {
  AutopilotIdSchema,
  AutopilotToolNameSchema
} from '../../../../shared/rpc-contract/autopilot-identifier-fields'
/** Model ids as the CLIs list them (claude-opus-5-5, gpt-6.1-sol, gemini-3.8-flash-high). */
export const AutopilotModelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
export const AutopilotEffortSchema = z.enum(AUTOPILOT_EFFORT_LEVELS)
export const AutopilotAccessSchema = z.enum(WORKFLOW_RUN_ACCESS_LEVELS)
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)
/** A reason is a code, never free text, so no secret or sentence can end up in a status row. */
export const ReasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
export const AutopilotLimitSchema = z.number().int().min(1).max(1000)
/** Only `Date.toISOString()` output, so string comparison orders timestamps correctly. */
export const UtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)))

/** Throws autopilot_invalid_input naming only the offending fields, never their values. */
export function parseAutopilotInput<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) {
    return parsed.data
  }
  const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(input)')
  throw new OrchestrationError('autopilot_invalid_input', `Invalid ${what}.`, { fields })
}

/** A row that fails its own schema means the table was changed outside the store. */
export function parseStoredRow<T>(schema: z.ZodType<T>, row: unknown, what: string): T {
  const parsed = schema.safeParse(row)
  if (parsed.success) {
    return parsed.data
  }
  throw new OrchestrationError(
    'autopilot_recovery_required',
    `A stored ${what} row is unreadable. Nothing was changed.`
  )
}

/** Autopilot writes open their own top-level transaction, so a later outer rollback cannot undo them. */
export function requireIdleAutopilotConnection(db: Database.Database): void {
  if (db.isTransaction) {
    throw new OrchestrationError(
      'autopilot_transaction_unavailable',
      'Autopilot requires an idle database connection.'
    )
  }
}

export function runAutopilotWrite<T>(
  db: Database.Database,
  savepoint: string,
  operation: () => T
): T {
  requireIdleAutopilotConnection(db)
  return runLifecycleWriteTransaction(db, savepoint, operation)
}

export function changedRowCount(result: { changes: number | bigint }): number {
  return Number(result.changes)
}

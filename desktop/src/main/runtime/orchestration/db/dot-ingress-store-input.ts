import type { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import {
  DOT_INGRESS_ERROR_MESSAGES,
  type DotIngressErrorCode
} from '../../../../shared/dot-ingress/dot-ingress-errors'
import { OrchestrationError } from '../orchestration-error'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'

// Internal codes: not part of the dot-facing contract, but still dot_-prefixed so the dispatcher passes them through.
const INVALID_INPUT = 'dot_invalid_input'
const TRANSACTION_UNAVAILABLE = 'dot_transaction_unavailable'

/** The contract's English message for a code, as an error the stores throw; data never holds request text. */
export function dotIngressError(code: DotIngressErrorCode, data?: unknown): OrchestrationError {
  return new OrchestrationError(code, DOT_INGRESS_ERROR_MESSAGES[code], data)
}

/** Names only the offending fields, never their values (an objective can hold anything). */
export function parseDotInput<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) {
    return parsed.data
  }
  const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(input)')
  throw new OrchestrationError(INVALID_INPUT, `Invalid ${what}.`, { fields })
}

/** An input refusal that says why; `reason` is a fixed code and never repeats the refused value. */
export function dotInputRefusal(
  message: string,
  fields: readonly string[],
  reason: string
): OrchestrationError {
  return new OrchestrationError(INVALID_INPUT, message, { fields, reason })
}

/** A row that fails its own schema means the table was changed outside the store. */
export function parseDotRow<T>(schema: z.ZodType<T>, row: unknown): T {
  const parsed = schema.safeParse(row)
  if (parsed.success) {
    return parsed.data
  }
  throw dotIngressError('dot_recovery_required')
}

/** Dot writes open their own top-level transaction, so a later outer rollback cannot undo them. */
export function requireIdleDotConnection(db: Database.Database): void {
  if (db.isTransaction) {
    throw new OrchestrationError(
      TRANSACTION_UNAVAILABLE,
      'The dot interface requires an idle database connection.'
    )
  }
}

export function runDotWrite<T>(db: Database.Database, savepoint: string, operation: () => T): T {
  requireIdleDotConnection(db)
  return runLifecycleWriteTransaction(db, savepoint, operation)
}

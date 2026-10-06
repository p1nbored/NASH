import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { toJsonColumn } from './autopilot-json-column'
import { changedRowCount, parseAutopilotInput } from './autopilot-store-input'
import {
  VALIDATION_CHECKS_MAX_CHARS,
  VALIDATION_EVIDENCE_MAX_CHARS,
  ValidationVerdictInputSchema,
  ValidationWaiverInputSchema,
  type ValidationVerdictInput,
  type ValidationWaiverInput
} from './task-validation-record'

function requireOwnedTransaction(db: Database.Database): void {
  if (!db.isTransaction) {
    throw new OrchestrationError(
      'autopilot_transaction_required',
      'A validation write must run inside the transaction that settles the task.'
    )
  }
}

function conflictOrMissing(db: Database.Database, validationId: string): OrchestrationError {
  const exists = db
    .prepare('SELECT 1 AS found FROM task_validations WHERE validation_id = ?')
    .get(validationId)
  return exists
    ? new OrchestrationError(
        'autopilot_validation_conflict',
        'The validation is already settled or was waived. Nothing was written.'
      )
    : new OrchestrationError('autopilot_validation_not_found', 'The validation was not found.')
}

/**
 * Records a verdict. A pending or inconclusive validation may be decided; pass and fail are final.
 * The caller owns the transaction, so the verdict and the Task's status move together, and nothing
 * else in the app writes a verdict.
 */
export function applyValidationVerdict(db: Database.Database, input: ValidationVerdictInput): void {
  const params = parseAutopilotInput(ValidationVerdictInputSchema, input, 'validation verdict')
  const checks = toJsonColumn(params.checks, VALIDATION_CHECKS_MAX_CHARS, 'validation checks')
  const evidence = toJsonColumn(
    params.evidenceRefs,
    VALIDATION_EVIDENCE_MAX_CHARS,
    'validation evidence'
  )
  requireOwnedTransaction(db)
  const result = db
    .prepare(
      `UPDATE task_validations SET verdict = ?, checks = ?, evidence_refs = ?, updated_at = ?
        WHERE validation_id = ? AND verdict IN ('pending', 'inconclusive') AND waiver IS NULL`
    )
    .run(params.verdict, checks, evidence, params.timestamp, params.validationId)
  if (changedRowCount(result) !== 1) {
    throw conflictOrMissing(db, params.validationId)
  }
}

/** Records that the user or dot accepted an inconclusive result; the verdict itself stays inconclusive. */
export function applyValidationWaiver(db: Database.Database, input: ValidationWaiverInput): void {
  const params = parseAutopilotInput(ValidationWaiverInputSchema, input, 'validation waiver')
  requireOwnedTransaction(db)
  const result = db
    .prepare(
      `UPDATE task_validations SET waiver = ?, waived_at = ?, updated_at = ?
        WHERE validation_id = ? AND verdict = 'inconclusive' AND waiver IS NULL`
    )
    .run(params.waiver, params.timestamp, params.timestamp, params.validationId)
  if (changedRowCount(result) !== 1) {
    throw conflictOrMissing(db, params.validationId)
  }
}

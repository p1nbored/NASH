import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'

/**
 * Workbench writes open their own top-level transaction: nested inside someone else's, a later
 * outer rollback would silently discard a write the caller already acted on.
 */
export function requireIdleWorkbenchConnection(db: Database.Database): void {
  if (db.isTransaction) {
    throw new OrchestrationError(
      'workbench_transaction_unavailable',
      'Workbench requires an idle database connection.'
    )
  }
}

/** For writes whose preceding checks must be atomic with them, such as spend cap checks. */
export function requireWorkbenchTransaction(db: Database.Database): void {
  if (!db.isTransaction) {
    throw new OrchestrationError(
      'workbench_transaction_required',
      'This Workbench write must run inside its store transaction.'
    )
  }
}

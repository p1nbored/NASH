import type { TaskClassificationStore } from '../orchestration/db/task-classification-store'
import type { WorkbenchClefSpendStore } from '../orchestration/db/workbench-clef-spend-store'
import { recoveredInterruptedInput } from './classification-record'

/** How many interrupted TaskSpecs one startup records; the rest wait for the next start. */
export const CLASSIFICATION_RECOVERY_BATCH = 500

export type ClassificationRecovery = {
  readonly releasedReservations: number
  readonly interruptedClassifications: number
}

export type ClassificationRecoveryDeps = {
  readonly spend: Pick<
    WorkbenchClefSpendStore,
    'releaseUnsettled' | 'listUnrecordedClassificationAttempts'
  >
  readonly classifications: Pick<TaskClassificationStore, 'record' | 'nextAttempt'>
  readonly now: () => number
}

/**
 * Startup, before any classification starts. Open reservations close as spent (an interrupted call may
 * have been billed), and each TaskSpec whose last billed attempt has no record gets a `blocked /
 * interrupted` one naming it. No network and no automatic paid retry: the primary session asks again.
 */
export function recoverInterruptedClassifications(
  deps: ClassificationRecoveryDeps
): ClassificationRecovery {
  const timestamp = new Date(deps.now()).toISOString()
  const releasedReservations = deps.spend.releaseUnsettled(timestamp)
  const lost = deps.spend.listUnrecordedClassificationAttempts(CLASSIFICATION_RECOVERY_BATCH)
  const recorded = lost.map((link) =>
    deps.classifications.record(
      recoveredInterruptedInput(link, deps.classifications.nextAttempt(link.taskId), timestamp)
    )
  )
  return { releasedReservations, interruptedClassifications: recorded.length }
}

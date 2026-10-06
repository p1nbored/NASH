import type {
  ClefSpendLedger,
  ClefSpendRefusal,
  ClefSpendReservationRow
} from './clef-spend-ledger'

/** The TaskSpec a classification bills to; the run's Workbench request carries the spend row (D-016). */
export type ClassificationSpendSubject = {
  readonly runId: string
  readonly taskId: string
  readonly requestId: string
}

/** One row of `clef_classification_spend`: the per-TaskSpec attempt behind a spend reservation. */
export type ClassificationSpendLink = {
  readonly reservationId: string
  readonly runId: string
  readonly taskId: string
  readonly attempt: number
}

/** The link-table side of the spend store; the ledger port covers the spend rows themselves. */
export type ClassificationSpendStore = {
  /** One top-level transaction around the attempt count and both inserts. */
  atomically<T>(operation: () => T): T
  countAttemptsForSubject(subjectId: string): number
  insertClassificationLink(link: ClassificationSpendLink): void
}

export type ClassificationReserveResult =
  | {
      readonly ok: true
      readonly reservation: ClefSpendReservationRow
      readonly link: ClassificationSpendLink
    }
  | { readonly ok: false; readonly refusal: ClefSpendRefusal }

export type ClassificationSpend = {
  /** Reserves one billed attempt for a TaskSpec, or names why the ledger refused; atomic either way. */
  reserve(
    subject: ClassificationSpendSubject,
    estimatedInputTokens: number
  ): ClassificationReserveResult
}

export type ClassificationSpendDeps = {
  readonly store: ClassificationSpendStore
  readonly ledger: Pick<ClefSpendLedger, 'reserve'>
}

/**
 * The D-016 re-key of the spend record: each classification is production spend linked to its
 * TaskSpec, bounded at the ledger's two billed attempts per TaskSpec. There is no spend cap (D-022).
 */
export function createClassificationSpend(deps: ClassificationSpendDeps): ClassificationSpend {
  const { store, ledger } = deps

  function reserveInTransaction(
    subject: ClassificationSpendSubject,
    estimatedInputTokens: number
  ): ClassificationReserveResult {
    const reserved = ledger.reserve({
      requestId: subject.requestId,
      subjectId: subject.taskId,
      purpose: 'production',
      estimatedInputTokens
    })
    if (!reserved.ok) {
      return reserved
    }
    const link: ClassificationSpendLink = {
      reservationId: reserved.reservation.reservationId,
      runId: subject.runId,
      taskId: subject.taskId,
      attempt: store.countAttemptsForSubject(subject.taskId) + 1
    }
    store.insertClassificationLink(link)
    return { ok: true, reservation: reserved.reservation, link }
  }

  return {
    reserve: (subject, estimatedInputTokens) =>
      store.atomically(() => reserveInTransaction(subject, estimatedInputTokens))
  }
}

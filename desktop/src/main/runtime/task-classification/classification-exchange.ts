import { getClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { ClefCredentialHandleLike } from '../../clef/clef-endpoint'
import { clefSpendRefusalBlocker, type ClefSpendReservationRow } from '../../clef/clef-spend-ledger'
import {
  CLEF_DEFAULT_MAX_ATTEMPTS,
  type ClefAttemptPermit,
  type ClefBeforeAttempt
} from '../../clef/clef-transport'
import { clefCallOutcomeFor, type ClefTransportOutcome } from '../../clef/clef-transport-outcome'
import type { ClassificationRun } from './classification-ports'
import type { PreparedClassification } from './classification-precall'
import { INTERRUPTED } from './classification-record'

export type ClassificationExchange = {
  readonly outcome: ClefTransportOutcome
  /** One reservation per billed attempt, in attempt order. */
  readonly reservations: readonly ClefSpendReservationRow[]
}

/**
 * The one paid call. Each billed attempt is recorded first, within the TaskSpec's retry bound, so
 * no attempt is sent without the ledger, and none after the classification stopped.
 */
export async function exchangeWithClef(
  run: ClassificationRun,
  prepared: PreparedClassification,
  credentials: ClefCredentialHandleLike
): Promise<ClassificationExchange> {
  const { subject } = run
  const spendSubject = {
    runId: subject.runId,
    taskId: subject.taskId,
    requestId: subject.requestId
  }
  let reservations: readonly ClefSpendReservationRow[] = []
  const beforeAttempt: ClefBeforeAttempt = (): ClefAttemptPermit => {
    if (run.signal.aborted) {
      return { proceed: false, blocker: INTERRUPTED }
    }
    const reserved = run.deps.spend.reserve(spendSubject, prepared.request.estimatedInputTokens)
    if (!reserved.ok) {
      return { proceed: false, blocker: clefSpendRefusalBlocker(reserved.refusal) }
    }
    reservations = [...reservations, reserved.reservation]
    return { proceed: true }
  }
  const outcome = await run.deps.transport({
    credentials,
    body: prepared.request.bodyBytes,
    signal: run.signal,
    maxAttempts: CLEF_DEFAULT_MAX_ATTEMPTS,
    beforeAttempt
  })
  const callOutcome = clefCallOutcomeFor(outcome)
  if (callOutcome !== null) {
    getClefCallCircuit().record(callOutcome, prepared.generation)
  }
  return { outcome, reservations }
}

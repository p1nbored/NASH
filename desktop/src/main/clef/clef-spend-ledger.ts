import { randomUUID } from 'node:crypto'
import type { ClefUsage } from '../../shared/clef/clef-answers'
import type { RouteBlocker, RouteBlockerDetail } from '../../shared/clef/clef-route-contract'
import {
  CLEF_MAX_SETTLEABLE_INPUT_TOKENS,
  CLEF_PRICE_BASIS,
  clefInputCostMicroUsd,
  clefInputNeurons,
  estimateClefReservation,
  isClefTokenCount
} from './clef-spend-pricing'

export {
  CLEF_PRICE_BASIS,
  CLEF_RESERVATION_MARGIN_MICRO_USD,
  CLEF_RESERVATION_MARGIN_NEURONS,
  clefInputCostMicroUsd,
  clefInputNeurons,
  estimateClefReservation,
  type ClefReservationEstimate
} from './clef-spend-pricing'

/** Spend ledger (D-022): records each billed attempt for spend and crash recovery; no limit. */

export const CLEF_SPEND_PURPOSES = ['production', 'verification', 'test'] as const
export type ClefSpendPurpose = (typeof CLEF_SPEND_PURPOSES)[number]
/** Purposes recorded as production spend; only they carry the retry bound. */
export const CLEF_PRODUCTION_PURPOSES: readonly ClefSpendPurpose[] = Object.freeze(['production'])
/** Purposes recorded together as verification and test spend. */
export const CLEF_VERIFICATION_PURPOSES: readonly ClefSpendPurpose[] = Object.freeze([
  'verification',
  'test'
])

/** Retry bound, not a budget (D-022): billed production attempts per TaskSpec, else per request. */
export const CLEF_BILLED_ATTEMPTS_PER_SUBJECT = 2

export type ClefSpendReservationRow = {
  reservationId: string
  /** Null only for verification and test calls, which belong to no Workbench request. */
  requestId: string | null
  purpose: ClefSpendPurpose
  /** 1-based billed attempt number for the request; null without a request. */
  attempt: number | null
  utcDayKey: string
  priceBasisVersion: number
  estimatedInputTokens: number
  reservedMicroUsd: number
  reservedNeurons: number
  reservedAt: string
}

export type ClefSpendSettlement = {
  /** `reservation_kept` when usage was missing or malformed: billing of failed calls is unverified. */
  basis: 'usage' | 'reservation_kept'
  spentMicroUsd: number
  spentNeurons: number
  inputTokens: number | null
  outputTokens: number | null
  outputCost: typeof CLEF_PRICE_BASIS.outputCost
  settledAt: string
}

/**
 * Persistence port; the production implementation is the `workbench_clef_spend` table.
 * Sums count a row's settled amount, or its reservation while unsettled.
 */
export type ClefSpendStore = {
  sumSpentMicroUsd(purposes: readonly ClefSpendPurpose[]): number
  /** Neurons on one UTC day for the given purposes; every purpose when `purposes` is omitted. */
  sumNeuronsForUtcDay(utcDayKey: string, purposes?: readonly ClefSpendPurpose[]): number
  countAttemptsForRequest(requestId: string): number
  /** Billed attempts of one classification subject (a TaskSpec), from the classification link. */
  countAttemptsForSubject(subjectId: string): number
  /** Several subjects share a request, so its next attempt number is not a count of one subject. */
  nextAttemptForRequest(requestId: string): number
  insertReservation(row: ClefSpendReservationRow): void
  settle(reservationId: string, settlement: ClefSpendSettlement): void
}

export const CLEF_SPEND_REFUSALS = [
  'invalid_estimate',
  'request_id_required',
  'request_attempts_exhausted'
] as const
export type ClefSpendRefusal = (typeof CLEF_SPEND_REFUSALS)[number]

export type ClefReserveResult =
  | { ok: true; reservation: ClefSpendReservationRow }
  | { ok: false; refusal: ClefSpendRefusal }

/** What was spent so far, kept as a read-out of the record; never a limit. */
export type ClefSpendSnapshot = {
  utcDayKey: string
  /** Verification and test spend over all time, in micro-dollars. */
  verificationMicroUsdSpent: number
  /** Production neurons on the current 00:00 UTC day. */
  dailyNeuronsSpent: number
}

export type ClefSpendLedger = {
  /**
   * Call inside the store's write transaction so the attempt count and the insert are atomic.
   * Verification and test calls pass `requestId: null`; a request id on them is recorded with an
   * attempt number but never bounded.
   */
  reserve(input: {
    requestId: string | null
    purpose: ClefSpendPurpose
    estimatedInputTokens: number
    /** A TaskSpec classification bounds its own attempts; the row still numbers attempts per request. */
    subjectId?: string
  }): ClefReserveResult
  settle(reservation: ClefSpendReservationRow, usage: ClefUsage | null): ClefSpendSettlement
  snapshot(): ClefSpendSnapshot
}

export type ClefSpendLedgerDeps = {
  store: ClefSpendStore
  now: () => number
  newId?: () => string
}

export function clefUtcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

const REFUSAL_DETAILS: Readonly<Record<ClefSpendRefusal, RouteBlockerDetail>> = Object.freeze({
  invalid_estimate: 'estimate_exceeded',
  request_id_required: 'request_rejected',
  request_attempts_exhausted: 'budget_exhausted'
})

export function clefSpendRefusalBlocker(refusal: ClefSpendRefusal): RouteBlocker {
  return {
    reason: 'classifier_unavailable',
    detail: REFUSAL_DETAILS[refusal]
  }
}

function settlementFor(
  reservation: ClefSpendReservationRow,
  usage: ClefUsage | null,
  settledAt: string
): ClefSpendSettlement {
  const outputCost = CLEF_PRICE_BASIS.outputCost
  if (!usage || !isClefTokenCount(usage.inputTokens, CLEF_MAX_SETTLEABLE_INPUT_TOKENS)) {
    return {
      basis: 'reservation_kept',
      spentMicroUsd: reservation.reservedMicroUsd,
      spentNeurons: reservation.reservedNeurons,
      inputTokens: null,
      outputTokens: null,
      outputCost,
      settledAt
    }
  }
  return {
    basis: 'usage',
    spentMicroUsd: clefInputCostMicroUsd(usage.inputTokens),
    spentNeurons: clefInputNeurons(usage.inputTokens),
    inputTokens: usage.inputTokens,
    outputTokens: isClefTokenCount(usage.outputTokens, Number.MAX_SAFE_INTEGER)
      ? usage.outputTokens
      : null,
    outputCost,
    settledAt
  }
}

type AttemptCounts = { prior: number | null; next: number | null }

/** The bounded subject's prior attempts and the request's next row number; none without a request. */
function attemptCountsOf(
  store: ClefSpendStore,
  input: { requestId: string | null; subjectId?: string }
): AttemptCounts {
  if (input.requestId === null) {
    return { prior: null, next: null }
  }
  const prior =
    input.subjectId === undefined
      ? store.countAttemptsForRequest(input.requestId)
      : store.countAttemptsForSubject(input.subjectId)
  return { prior, next: store.nextAttemptForRequest(input.requestId) }
}

function retryBoundReached(purpose: ClefSpendPurpose, priorAttempts: number | null): boolean {
  return (
    CLEF_PRODUCTION_PURPOSES.includes(purpose) &&
    priorAttempts !== null &&
    priorAttempts >= CLEF_BILLED_ATTEMPTS_PER_SUBJECT
  )
}

export function createClefSpendLedger(deps: ClefSpendLedgerDeps): ClefSpendLedger {
  const { store, now } = deps
  const newId = deps.newId ?? randomUUID

  return {
    reserve(input) {
      const estimate = estimateClefReservation(input.estimatedInputTokens)
      if (!estimate) {
        return { ok: false, refusal: 'invalid_estimate' }
      }
      if (input.requestId === null && input.purpose === 'production') {
        return { ok: false, refusal: 'request_id_required' }
      }
      const attempts = attemptCountsOf(store, input)
      if (retryBoundReached(input.purpose, attempts.prior)) {
        return { ok: false, refusal: 'request_attempts_exhausted' }
      }
      const nowMs = now()
      const reservation: ClefSpendReservationRow = {
        reservationId: newId(),
        requestId: input.requestId,
        purpose: input.purpose,
        attempt: attempts.next,
        utcDayKey: clefUtcDayKey(nowMs),
        priceBasisVersion: CLEF_PRICE_BASIS.version,
        estimatedInputTokens: input.estimatedInputTokens,
        reservedMicroUsd: estimate.reservedMicroUsd,
        reservedNeurons: estimate.reservedNeurons,
        reservedAt: new Date(nowMs).toISOString()
      }
      store.insertReservation(reservation)
      return { ok: true, reservation }
    },

    settle(reservation, usage) {
      const settlement = settlementFor(reservation, usage, new Date(now()).toISOString())
      store.settle(reservation.reservationId, settlement)
      return settlement
    },

    snapshot() {
      const utcDayKey = clefUtcDayKey(now())
      return {
        utcDayKey,
        verificationMicroUsdSpent: store.sumSpentMicroUsd(CLEF_VERIFICATION_PURPOSES),
        dailyNeuronsSpent: store.sumNeuronsForUtcDay(utcDayKey, CLEF_PRODUCTION_PURPOSES)
      }
    }
  }
}

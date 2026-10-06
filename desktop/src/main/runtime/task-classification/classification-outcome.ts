import type { ClefUsage } from '../../../shared/clef/clef-answers'
import { decideClassification } from '../../clef/clef-classification-rules'
import { validateClefResponse } from '../../clef/clef-response-validation'
import type {
  ClefSpendLedger,
  ClefSpendReservationRow,
  ClefSpendSettlement
} from '../../clef/clef-spend-ledger'
import type { ClefTransportBlocked, ClefTransportResponse } from '../../clef/clef-transport-outcome'
import type { ClassificationExchange } from './classification-exchange'
import type { ClassificationRun } from './classification-ports'
import type { PreparedClassification } from './classification-precall'
import {
  NO_CALL,
  blockedRecord,
  interruptedRecord,
  recordedAnswersOf,
  type ClassificationBody,
  type ClassificationCall,
  type Recordable
} from './classification-record'

/**
 * Every attempt but the last stays spent at its bound (billing of a failed call is unverified); the
 * last settles from usage when the answer validated. A settlement that never ran is closed at startup.
 */
function settleReservations(
  ledger: Pick<ClefSpendLedger, 'settle'>,
  reservations: readonly ClefSpendReservationRow[],
  usage: ClefUsage | null
): ClefSpendSettlement | null {
  const settlements = reservations.map((reservation, index) =>
    ledger.settle(reservation, index === reservations.length - 1 ? usage : null)
  )
  return settlements.at(-1) ?? null
}

function callOf({ outcome, reservations }: ClassificationExchange): ClassificationCall {
  return {
    ...NO_CALL,
    attempts: outcome.attempts,
    spendReservationId: reservations.at(-1)?.reservationId ?? null,
    earlierReservationIds: reservations.slice(0, -1).map((row) => row.reservationId)
  }
}

type Verdict = { readonly body: ClassificationBody; readonly usage: ClefUsage | null }

/** Validation, then the reject-only outcome rules (design 1.3): the only path from bytes to a type. */
function judgeResponse(prepared: PreparedClassification, bytes: Uint8Array): Verdict {
  const validation = validateClefResponse({
    rawBytes: bytes,
    questions: prepared.request.body.questions,
    estimatedInputTokens: prepared.request.estimatedInputTokens,
    profile: prepared.profile.profile
  })
  if (!validation.ok) {
    return { body: blockedRecord(validation.blocker).body, usage: null }
  }
  const { answers } = validation
  const decision = decideClassification({ ok: true, answers })
  if (decision.outcome !== 'classified') {
    return {
      body: blockedRecord(decision.blocker, undefined, undefined, answers).body,
      usage: answers.usage
    }
  }
  const body: ClassificationBody = {
    kind: 'classified',
    result: decision.result,
    answers: recordedAnswersOf(answers),
    cacheSource: null
  }
  return { body, usage: answers.usage }
}

function recordResponse(
  run: ClassificationRun,
  prepared: PreparedClassification,
  response: ClefTransportResponse,
  reservations: readonly ClefSpendReservationRow[],
  call: ClassificationCall
): Recordable {
  const { deps, subject } = run
  // Why: the raw bytes are stored before any parsing, so the evidence outlives a validator bug.
  const receipt = deps.rawResponses.insert({
    rawResponseId: `raw_${deps.newId()}`,
    requestId: subject.requestId,
    spendReservationId: call.spendReservationId,
    httpStatus: response.status,
    // Why a copy: the store takes ArrayBuffer-backed bytes, and the transport buffer is not ours to share.
    requestBody: Uint8Array.from(prepared.request.bodyBytes),
    responseBody: Uint8Array.from(response.bytes)
  })
  const verdict = judgeResponse(prepared, response.bytes)
  const settlement = settleReservations(deps.ledger, reservations, verdict.usage)
  return {
    body: verdict.body,
    evidence: prepared.evidence,
    call: {
      ...call,
      rawResponseId: receipt.rawResponseId,
      rawResponseSha256: receipt.responseBodySha256,
      computedNeurons: settlement?.basis === 'usage' ? settlement.spentNeurons : null
    }
  }
}

function transportBlock(
  outcome: ClefTransportBlocked,
  prepared: PreparedClassification,
  call: ClassificationCall
): Recordable {
  // Why: an oversized body is Clef's answer but is neither stored nor parsed; it is invalid_output.
  return blockedRecord(outcome.blocker, prepared.evidence, {
    ...call,
    transportErrorClass: outcome.errorClass
  })
}

/** Settles the spend of every attempt and returns the classification's one record. */
export function finishExchange(
  run: ClassificationRun,
  prepared: PreparedClassification,
  exchange: ClassificationExchange
): Recordable {
  const { outcome, reservations } = exchange
  const call = callOf(exchange)
  // Why the signal: an answer that arrives after a cancel or shutdown is paid for but never acted on.
  if (outcome.kind === 'response' && !run.signal.aborted) {
    return recordResponse(run, prepared, outcome, reservations, call)
  }
  settleReservations(run.deps.ledger, reservations, null)
  if (outcome.kind === 'blocked' && !run.signal.aborted) {
    return transportBlock(outcome, prepared, call)
  }
  return interruptedRecord(run.signal, prepared.evidence, call)
}

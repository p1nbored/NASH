import type { RouteBlocker, RoutingStatus } from '../../../shared/clef/clef-route-contract'
import {
  ClefProfilePinResultSchema,
  ClefVerifyResultSchema,
  type ClefProfilePinResult,
  type ClefVerifyResult
} from '../../../shared/clef/clef-verification-view'
import { getClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { ClefCredentialSourcePort, ClefTransportPort } from '../../clef/clef-call-ports'
import {
  clefSpendRefusalBlocker,
  type ClefSpendLedger,
  type ClefSpendRefusal,
  type ClefSpendReservationRow
} from '../../clef/clef-spend-ledger'
import {
  clefVerificationReportSha256,
  clefVerifiedProfileFromReport,
  type ClefSchemaPins,
  type ClefVerifiedProfileFileStore
} from '../../clef/clef-verified-profile'
import {
  buildClefVerificationReport,
  type ClefVerificationReport
} from '../../clef/clef-verification-report'
import type { ClefAttemptPermit } from '../../clef/clef-transport'
import { clefCallOutcomeFor, type ClefTransportOutcome } from '../../clef/clef-transport-outcome'
import type { WorkbenchClefSpendStore } from '../orchestration/db/workbench-clef-spend-store'
import { buildClefVerificationRequest } from './clef-verification-request'
import { toClefVerificationReportView } from './clef-verification-report-view'
import {
  clefSpendRefusalError,
  clefVerifierError,
  requireVerifiableClef,
  type VerifiableClef
} from './clef-verifier-refusals'
import type { RoutingAbortRegistry } from './routing-abort-registry'

/** The abort-registry key of the one verification call; request ids are uuids, so it cannot collide. */
export const CLEF_VERIFICATION_ABORT_KEY = 'clef:verification'

const INTERRUPTED: RouteBlocker = Object.freeze({
  reason: 'classifier_unavailable',
  detail: 'interrupted'
})

export type ClefVerifierDeps = {
  readonly credentials: ClefCredentialSourcePort
  /** Records the call's spend; it sets no limit (D-022). */
  readonly ledger: Pick<ClefSpendLedger, 'reserve' | 'settle'>
  /** `routes.spend`: verification reserves through `spend.atomically` with no request id. */
  readonly spend: Pick<WorkbenchClefSpendStore, 'atomically'>
  readonly transport: ClefTransportPort
  readonly aborts: RoutingAbortRegistry
  readonly clock: { now(): number }
  readonly profileStore: Pick<ClefVerifiedProfileFileStore, 'write'>
  readonly schemaPins: ClefSchemaPins
  /** The status after a pin, read from the same local state the routing gates use. */
  readonly routingStatus: () => RoutingStatus
  /** Sink for unexpected failures; the runtime installs a redacting logger. */
  readonly onFailure?: (error: unknown) => void
}

export type ClefVerifier = {
  /** The opt-in tier-2 call (spec section 14); throws a refusal when it cannot run, spends nothing then. */
  verify(): Promise<ClefVerifyResult>
  /** Writes the verified profile for the report the user confirmed; refuses any other report. */
  pin(reportSha256: string): ClefProfilePinResult
}

type HeldReport = { readonly report: ClefVerificationReport; readonly sha256: string }

/** What the single billed attempt reserved, or why the ledger refused. */
type AttemptLedger = {
  reservation: ClefSpendReservationRow | null
  refusal: ClefSpendRefusal | null
}

/** Closes the ledger record of the attempt; the result never shows its cost (D-022). */
function settleAttempt(
  deps: ClefVerifierDeps,
  attempt: AttemptLedger,
  report: ClefVerificationReport | null
): void {
  if (attempt.reservation === null) {
    return
  }
  const usage = report?.usage
  // Why: usage settles only when both counts are present; otherwise billing is unverified and the reservation stays spent.
  const settled =
    usage?.inputTokens != null && usage.outputTokens != null
      ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
      : null
  deps.ledger.settle(attempt.reservation, settled)
}

function failedBlocker(outcome: ClefTransportOutcome): RouteBlocker {
  return outcome.kind === 'blocked' ? outcome.blocker : INTERRUPTED
}

function failedStatus(outcome: ClefTransportOutcome): number | null {
  return outcome.kind === 'blocked' ? outcome.status : null
}

export function createClefVerifier(deps: ClefVerifierDeps): ClefVerifier {
  let held: HeldReport | null = null

  /** One attempt, reserved through the ledger inside its own transaction before it is sent. */
  async function callOnce(
    ready: VerifiableClef,
    body: Uint8Array,
    estimatedInputTokens: number,
    signal: AbortSignal
  ): Promise<{ outcome: ClefTransportOutcome; attempt: AttemptLedger }> {
    const attempt: AttemptLedger = { reservation: null, refusal: null }
    const outcome = await deps.transport({
      credentials: ready.handle,
      body,
      signal,
      maxAttempts: 1,
      beforeAttempt: (): ClefAttemptPermit => {
        const reserved = deps.spend.atomically(() =>
          deps.ledger.reserve({ requestId: null, purpose: 'verification', estimatedInputTokens })
        )
        if (!reserved.ok) {
          attempt.refusal = reserved.refusal
          return { proceed: false, blocker: clefSpendRefusalBlocker(reserved.refusal) }
        }
        attempt.reservation = reserved.reservation
        return { proceed: true }
      }
    })
    const callOutcome = clefCallOutcomeFor(outcome)
    if (callOutcome !== null) {
      getClefCallCircuit().record(callOutcome, ready.generation)
    }
    return { outcome, attempt }
  }

  async function run(ready: VerifiableClef, signal: AbortSignal): Promise<ClefVerifyResult> {
    const { request, sent } = buildClefVerificationRequest()
    const { outcome, attempt } = await callOnce(
      ready,
      request.bodyBytes,
      request.estimatedInputTokens,
      signal
    )
    if (attempt.refusal !== null && attempt.reservation === null) {
      throw clefSpendRefusalError(attempt.refusal)
    }
    if (outcome.kind !== 'response') {
      settleAttempt(deps, attempt, null)
      return ClefVerifyResultSchema.parse({
        outcome: 'call_failed',
        blocker: failedBlocker(outcome),
        httpStatus: failedStatus(outcome),
        attempts: outcome.attempts
      })
    }
    const report = buildClefVerificationReport(
      { status: outcome.status, bytes: outcome.bytes },
      sent
    )
    // Why settle first: the call is paid for, so the ledger is closed before anything can throw.
    settleAttempt(deps, attempt, report)
    const reportSha256 = clefVerificationReportSha256(report)
    const pin = clefVerifiedProfileFromReport(report, {
      verifiedAt: new Date(deps.clock.now()).toISOString(),
      schemaPins: deps.schemaPins
    })
    held = { report, sha256: reportSha256 }
    return ClefVerifyResultSchema.parse({
      outcome: 'reported',
      report: toClefVerificationReportView(report),
      reportSha256,
      pin: pin.ok ? { pinnable: true, problems: [] } : { pinnable: false, problems: pin.problems }
    })
  }

  return {
    async verify() {
      // Why the slot first: a second click must be refused before it can touch the circuit or the credentials.
      const controller = deps.aborts.begin(CLEF_VERIFICATION_ABORT_KEY)
      if (controller === null) {
        throw clefVerifierError(
          'workbench_clef_verification_in_progress',
          'A verification call is already running.'
        )
      }
      try {
        const ready = requireVerifiableClef(deps)
        // Why cleared here: a report from an earlier call must not stay pinnable beside a newer attempt.
        held = null
        return await run(ready, controller.signal)
      } finally {
        deps.aborts.end(CLEF_VERIFICATION_ABORT_KEY, controller)
      }
    },

    pin(reportSha256) {
      const confirmed = held
      if (confirmed === null || confirmed.sha256 !== reportSha256) {
        throw clefVerifierError(
          'workbench_clef_report_unconfirmed',
          'No verification report matches the one you confirmed. Run verification again.'
        )
      }
      const verifiedAt = new Date(deps.clock.now()).toISOString()
      const derived = clefVerifiedProfileFromReport(confirmed.report, {
        verifiedAt,
        schemaPins: deps.schemaPins
      })
      if (!derived.ok) {
        throw clefVerifierError(
          'workbench_clef_report_not_pinnable',
          `The verification report cannot be pinned: ${derived.problems.join(', ')}.`
        )
      }
      let profileHash: string
      try {
        profileHash = deps.profileStore.write(derived.profile).profileHash
      } catch (error) {
        deps.onFailure?.(error)
        throw clefVerifierError(
          'workbench_clef_profile_write_failed',
          'The verified profile could not be written.'
        )
      }
      held = null
      return ClefProfilePinResultSchema.parse({
        pinned: true,
        profileHash,
        verifiedAt,
        routingStatus: deps.routingStatus()
      })
    }
  }
}

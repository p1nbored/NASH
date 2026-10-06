import type {
  ClefProfilePinResult,
  ClefVerifyResult
} from '../../../shared/clef/clef-verification-view'
import type { WorkbenchRoutingStatusView } from '../../../shared/clef/workbench-routing-status-view'
import type { ClefSchemaPins, ClefVerifiedProfileFileStore } from '../../clef/clef-verified-profile'
import type { WorkbenchClefSpendStore } from '../orchestration/db/workbench-clef-spend-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { createClefVerifier, type ClefVerifierDeps } from './clef-verifier'
import { clefVerifierError } from './clef-verifier-refusals'
import { readRoutingStatus } from './routing-status-reader'
import { readRoutingStatusView } from './routing-status-view'

/** What the status view, the opt-in verification and the profile pin need. */
export type WorkbenchClefAdminDeps = {
  /** `routes.spend`: verification reserves through its transaction runner with no request id. */
  readonly spend: Pick<WorkbenchClefSpendStore, 'atomically'>
  /** The only writer of the verified profile; main owns the file behind it. Its read is unchecked. */
  readonly profileStore: Pick<ClefVerifiedProfileFileStore, 'read' | 'write'>
  readonly schemaPins: ClefSchemaPins
}

/** The Clef ports only: with no router or eligibility source here, nothing can classify at intake. */
export type WorkbenchRoutingRuntimeDeps = Pick<
  ClefVerifierDeps,
  'credentials' | 'ledger' | 'transport' | 'aborts' | 'clock' | 'onFailure'
> & {
  readonly verifiedProfile: Pick<ClefVerifiedProfileFileStore, 'read'>
  /** Without it the status view, verification and pin fail closed with `workbench_clef_unavailable`. */
  readonly admin?: WorkbenchClefAdminDeps
}

/** What the RPC layer uses; every member reads only local state or runs the opt-in verification. */
export type WorkbenchRoutingRuntime = {
  /** `workbench.routing.status`: status, latch and circuit times; never a secret or a cost. */
  routingStatusView(): WorkbenchRoutingStatusView
  /** `workbench.clef.verify`: the opt-in verification call; the ledger records its spend, no cap applies. */
  verifyClef(): Promise<ClefVerifyResult>
  /** `workbench.clef.profile.pin`: writes the profile only for the report the user confirmed. */
  pinClefProfile(reportSha256: string): ClefProfilePinResult
  /** Shutdown: aborts the in-flight verification call, if any; returns how many were aborted. */
  abortAllRouting(): number
  reportFailure(error: unknown): void
}

function clefAdminUnavailable() {
  return clefVerifierError(
    'workbench_clef_unavailable',
    'Clef administration is not wired in this build.'
  )
}

export function createWorkbenchRoutingRuntime(
  deps: WorkbenchRoutingRuntimeDeps
): WorkbenchRoutingRuntime {
  const { admin } = deps
  const verifier =
    admin === undefined
      ? null
      : createClefVerifier({
          credentials: deps.credentials,
          ledger: deps.ledger,
          spend: admin.spend,
          transport: deps.transport,
          aborts: deps.aborts,
          clock: deps.clock,
          profileStore: admin.profileStore,
          schemaPins: admin.schemaPins,
          routingStatus: () => readRoutingStatus(deps),
          onFailure: deps.onFailure
        })
  return {
    routingStatusView() {
      if (admin === undefined) {
        throw clefAdminUnavailable()
      }
      return readRoutingStatusView(deps, { dispatch: false, storedProfile: admin.profileStore })
    },
    async verifyClef() {
      if (verifier === null) {
        throw clefAdminUnavailable()
      }
      return verifier.verify()
    },
    pinClefProfile(reportSha256) {
      if (verifier === null) {
        throw clefAdminUnavailable()
      }
      return verifier.pin(reportSha256)
    },
    abortAllRouting: () => deps.aborts.abortAll(),
    reportFailure: (error) => deps.onFailure?.(error)
  }
}

let installed: WorkbenchRoutingRuntime | null = null

/** Main startup installs the runtime after the database opens; null removes it. */
export function setWorkbenchRoutingRuntime(runtime: WorkbenchRoutingRuntime | null): void {
  installed = runtime
}

/** Null until installed. */
export function getWorkbenchRoutingRuntime(): WorkbenchRoutingRuntime | null {
  return installed
}

/** For the RPC layer: administration that was never installed refuses with a workbench error code. */
export function requireWorkbenchRoutingRuntime(): WorkbenchRoutingRuntime {
  if (installed === null) {
    throw new OrchestrationError(
      'workbench_routing_not_configured',
      'Routing is not available in this session.'
    )
  }
  return installed
}

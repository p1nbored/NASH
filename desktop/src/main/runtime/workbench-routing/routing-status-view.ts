import type { WorkbenchRoutingStatusView } from '../../../shared/clef/workbench-routing-status-view'
import { CLEF_QUESTION_BUNDLE_SHA256 } from '../../clef/clef-question-set'
import type { ClefVerifiedProfileFileStore } from '../../clef/clef-verified-profile'
import { readVerifiedBundleSha256 } from './clef-bundle-view'
import { readRoutingStatus, type RoutingStatusDeps } from './routing-status-reader'

export type RoutingStatusViewDeps = RoutingStatusDeps

export type RoutingStatusViewInputs = {
  /** Whether a dispatch handoff exists; the runtime decides, this only reports it. */
  readonly dispatch: boolean
  /** The profile file as stored, before the pin check: it names the bundle it was verified against. */
  readonly storedProfile: Pick<ClefVerifiedProfileFileStore, 'read'>
}

/**
 * The renderer-safe status for `workbench.routing.status`. It reads local state only (credential
 * presence, the profile file and the in-memory circuit), so it works in an outage and never
 * spends: no call, no reservation, no probe. It reports no spend cap or cost (D-022).
 */
export function readRoutingStatusView(
  deps: RoutingStatusViewDeps,
  inputs: RoutingStatusViewInputs
): WorkbenchRoutingStatusView {
  const status = readRoutingStatus(deps)
  const credentials = deps.credentials.status()
  const profile = deps.verifiedProfile.read()
  return {
    status,
    dispatch: inputs.dispatch,
    credentials: {
      tokenPresent: credentials.tokenPresent,
      accountPresent: credentials.accountPresent,
      protection: credentials.protection
    },
    profile: {
      present: profile !== null,
      verifiedAt: profile?.profile.verifiedAt ?? null,
      verifiedAgainstBundleSha256: readVerifiedBundleSha256(inputs.storedProfile)
    },
    bundle: { sha256: CLEF_QUESTION_BUNDLE_SHA256 }
  }
}

import type {
  DotRemotePairAgainReason,
  DotRemoteTokenReconnectReason
} from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { DotRemoteSiteFailure } from './dot-remote-site-client'

// What the agent does after a failed Site call. An ended pairing (revoked, reused or unknown
// credential, lifetime reached) is fenced and the user pairs again; a refused service token stops
// polling until the user pastes a new one (no fallback of any kind); a lost session is resumed with
// the device credential; everything else is retried later and keeps every credential.

export type DotRemoteFailureAction =
  | { action: 'pair_again'; reason: DotRemotePairAgainReason }
  | { action: 'reconnect'; reason: DotRemoteTokenReconnectReason }
  /** The session is gone but the pairing may live: refresh it with the device credential. */
  | { action: 'session_lost' }
  | { action: 'retry' }
  /** The agent itself stopped the call (switch off, quit); nothing is wrong with the Site. */
  | { action: 'ignore' }

const PAIR_AGAIN_BY_CODE: Readonly<Record<string, DotRemotePairAgainReason>> = {
  generation_revoked: 'pairing_revoked',
  device_credential_reused: 'device_credential_reused',
  device_credential_invalid: 'device_credential_invalid',
  pairing_expired: 'pairing_expired'
}

export function failureAction(failure: DotRemoteSiteFailure): DotRemoteFailureAction {
  if (failure.kind === 'rejected') {
    return { action: 'reconnect', reason: 'service_token_rejected' }
  }
  if (failure.kind === 'unavailable' && failure.reason === 'aborted') {
    return { action: 'ignore' }
  }
  if (failure.kind !== 'site_error') {
    return { action: 'retry' }
  }
  const pairAgain = PAIR_AGAIN_BY_CODE[failure.code]
  if (pairAgain) {
    return { action: 'pair_again', reason: pairAgain }
  }
  return failure.code === 'session_expired' || failure.code === 'unauthorized'
    ? { action: 'session_lost' }
    : { action: 'retry' }
}

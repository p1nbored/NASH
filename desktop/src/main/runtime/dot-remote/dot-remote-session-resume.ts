import type { DotRemotePairAgainReason } from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { DotRemoteDeviceCredential, DotRemoteServiceToken } from './dot-remote-credentials'
import type { DotRemoteIssuedSession } from './dot-remote-pairing'
import type { DotRemotePairingRecord } from './dot-remote-settings-store'
import {
  siteFailureOf,
  type DotRemoteSiteClient,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'

// Resumes a live pairing without the owner: the sealed device credential, in its own header only,
// buys a new session and a rotated credential. The rotated credential is sealed before the session is
// used; when it cannot be, the pairing ends here, because the presented credential is already spent.

export type DotRemoteResumeOutcome =
  | { kind: 'idle' }
  | { kind: 'resumed'; session: DotRemoteIssuedSession }
  | { kind: 'failure'; failure: DotRemoteSiteFailure }
  | { kind: 'no_service_token' }
  | { kind: 'ended'; reason: DotRemotePairAgainReason }

export type DotRemoteResumeInput = {
  readonly site: DotRemoteSiteClient
  /** The live pairing to resume, or null when there is none. */
  readonly record: DotRemotePairingRecord | null
  readonly service: () => DotRemoteServiceToken | null
  readonly device: () => DotRemoteDeviceCredential | null
  /** False when the pairing was fenced or replaced while the refresh was in flight. */
  readonly stillResumable: (record: DotRemotePairingRecord) => boolean
  /** Seals the rotated credential in one atomic write; false when nothing was stored. */
  readonly save: (credential: string) => boolean
}

export async function resumeDotRemoteSession(
  input: DotRemoteResumeInput
): Promise<DotRemoteResumeOutcome> {
  const { record } = input
  if (record === null) {
    return { kind: 'idle' }
  }
  const service = input.service()
  if (!service) {
    return { kind: 'no_service_token' }
  }
  const device = input.device()
  if (!device) {
    return { kind: 'ended', reason: 'session_ended' }
  }
  const result = await input.site.call(
    'pairing.session.refresh',
    { generation: record.generation },
    // Why no abort signal: the Site rotates on receipt, so a refresh cut short (quit, switch off)
    // would leave a superseded credential that ends the pairing as reused on the next start.
    { credentials: { service, session: null, device } }
  )
  if (!result.ok) {
    return { kind: 'failure', failure: siteFailureOf(result) }
  }
  if (!input.stillResumable(record)) {
    // Why: revoked or replaced meanwhile; the rotated credential belongs to a fenced pairing.
    return { kind: 'idle' }
  }
  const { session, deviceCredential } = result.value
  if (session.generation !== record.generation || session.deviceId !== record.deviceId) {
    return { kind: 'ended', reason: 'pairing_revoked' }
  }
  return input.save(deviceCredential.credential)
    ? { kind: 'resumed', session }
    : { kind: 'ended', reason: 'device_credential_unsaved' }
}
